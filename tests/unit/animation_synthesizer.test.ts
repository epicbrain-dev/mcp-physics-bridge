import { describe, it, expect, beforeEach } from "vitest";
import { AnimationSynthesizer } from "../../src/animation/synthesizer.js";
import {
  GenreTemplate,
  AnimationLayer,
  AnimationIntent,
} from "../../src/proto/index.js";

describe("AnimationSynthesizer (End-to-End Rig Synthesis Pipeline)", () => {
  let synthesizer: AnimationSynthesizer;

  beforeEach(() => {
    synthesizer = new AnimationSynthesizer({
      genre: GenreTemplate.GENRE_ACTION_RPG,
      enableSmoothing: true,
      smoothingFactor: 0.5,
    });
  });

  describe("End-to-End Intent Processing Pipeline", () => {
    it("processes single intent and produces valid SynthesizedAnimationState", () => {
      const intent: AnimationIntent = {
        intentName: "Attack", // Synonym for LightAttack in Action RPG
        priority: 25,
        desiredVelocity: 1.5,
        intensity: 1.0,
      };

      const state = synthesizer.processIntent(101, 1001n, intent);
      expect(state.entityId).toBe(101);
      expect(state.frameId).toBe(1001n);
      expect(state.activeIntent).toBe("LightAttack");
      expect(state.blendWeights.length).toBeGreaterThan(0);
      const totalWeight = state.blendWeights.reduce((sum, w) => sum + w.weight, 0);
      expect(totalWeight).toBeCloseTo(1.0);
      expect(state.playbackScale).toBeGreaterThan(0);
      expect(state.arbitrationPreempted).toBe(false);
      expect(state.layer).toBe(AnimationLayer.LAYER_UPPER_BODY); // Inferred from LightAttack affinity
    });

    it("preempts lower-priority action with preemption diagnostic reason", () => {
      const entityId = 202;

      // Frame 1: Low priority walk
      const walkState = synthesizer.processIntent(entityId, 1n, {
        intentName: "Walk",
        priority: 10,
        desiredVelocity: 3.0,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_FULL_BODY,
      });
      expect(walkState.activeIntent).toBe("Walk");
      expect(walkState.arbitrationPreempted).toBe(false);

      // Frame 2: High priority DodgeRoll
      const rollState = synthesizer.processIntent(entityId, 2n, {
        intentName: "DodgeRoll",
        priority: 60,
        desiredVelocity: 8.0,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_FULL_BODY,
      });
      expect(rollState.activeIntent).toBe("DodgeRoll");
      expect(rollState.arbitrationPreempted).toBe(true);
      expect(rollState.preemptedReason).toContain("Walk");
      expect(rollState.preemptedReason).toContain("candidate priority 60 > previous 10");
    });
  });

  describe("Multi-Layer Concurrent Skeletal Synthesis", () => {
    it("tracks independent animations simultaneously on LowerBody and UpperBody", () => {
      const entityId = 303;

      // Lower body runs
      const lowerState = synthesizer.processIntent(entityId, 10n, {
        intentName: "Sprint",
        priority: 20,
        desiredVelocity: 6.5,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_LOWER_BODY,
      });

      // Upper body casts spell
      const upperState = synthesizer.processIntent(entityId, 11n, {
        intentName: "CastSpell",
        priority: 40,
        desiredVelocity: 0,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_UPPER_BODY,
      });

      expect(lowerState.activeIntent).toBe("Sprint");
      expect(lowerState.layer).toBe(AnimationLayer.LAYER_LOWER_BODY);
      expect(lowerState.arbitrationPreempted).toBe(false);

      expect(upperState.activeIntent).toBe("CastSpell");
      expect(upperState.layer).toBe(AnimationLayer.LAYER_UPPER_BODY);
      expect(upperState.arbitrationPreempted).toBe(false);
    });
  });

  describe("Tick Entity Simulation & Action Expiration", () => {
    it("advances simulation and expires transient one-shot actions to idle fallback", () => {
      const entityId = 404;

      // Initiate DodgeRoll (configured duration = 0.65s)
      synthesizer.processIntent(entityId, 1n, {
        intentName: "DodgeRoll",
        priority: 50,
        desiredVelocity: 8.0,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_FULL_BODY,
      });

      // Tick for 0.3 seconds: DodgeRoll should still be active
      let states = synthesizer.tickEntity(entityId, 2n, 0.3);
      const fullBodyMid = states.find((s) => s.layer === AnimationLayer.LAYER_FULL_BODY);
      expect(fullBodyMid?.activeIntent).toBe("DodgeRoll");

      // Tick another 0.4 seconds (total 0.7s > 0.65s): action expires, transitions to fallback Idle
      states = synthesizer.tickEntity(entityId, 3n, 0.4);
      const fullBodyEnd = states.find((s) => s.layer === AnimationLayer.LAYER_FULL_BODY);
      expect(fullBodyEnd?.activeIntent).toBe("Idle");
    });
  });

  describe("Multi-Entity Isolation & Genre Switching", () => {
    it("isolates animation states between different entities", () => {
      const e1 = 1;
      const e2 = 2;

      synthesizer.processIntent(e1, 1n, {
        intentName: "Sprint",
        priority: 20,
        desiredVelocity: 6.5,
        intensity: 1.0,
      });

      synthesizer.processIntent(e2, 1n, {
        intentName: "Block",
        priority: 30,
        desiredVelocity: 0.8,
        intensity: 1.0,
      });

      const tickE1 = synthesizer.tickEntity(e1, 2n, 0.016);
      const tickE2 = synthesizer.tickEntity(e2, 2n, 0.016);

      expect(tickE1.some((s) => s.activeIntent === "Sprint")).toBe(true);
      expect(tickE2.some((s) => s.activeIntent === "Block")).toBe(true);
    });

    it("switches genre templates dynamically", () => {
      synthesizer.setGenre(GenreTemplate.GENRE_VEHICLE);

      const state = synthesizer.processIntent(505, 1n, {
        intentName: "Turbo", // Vehicle synonym for Boost
        priority: 10,
        desiredVelocity: 35.0,
        intensity: 1.0,
      });

      expect(state.activeIntent).toBe("Boost");
    });
  });
});
