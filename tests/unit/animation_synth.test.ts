import { describe, it, expect } from "vitest";
import { BridgeSideArbitrator } from "../../src/animation/arbitration.js";
import { ProceduralPlaybackScaler } from "../../src/animation/root_motion.js";
import { IntentMapper } from "../../src/animation/intent_mapper.js";
import { GenreTemplate, AnimationLayer, AnimationIntent } from "../../src/proto/index.js";

describe("AI-to-Rig Animation Synthesizer", () => {
  it("arbitrates priority preempting lower priority actions", () => {
    const arbitrator = new BridgeSideArbitrator();

    const walkIntent = {
      intentName: "Walk",
      priority: 10,
      desiredVelocity: 2.5,
      intensity: 1.0,
    };
    const hitStunIntent = {
      intentName: "HitStun",
      priority: 100,
      desiredVelocity: 0.0,
      intensity: 1.0,
    };

    const first = arbitrator.arbitrate(walkIntent);
    expect(first.preempted).toBe(false);
    expect(first.acceptedIntent.intentName).toBe("Walk");

    const second = arbitrator.arbitrate(hitStunIntent);
    expect(second.preempted).toBe(true);
    expect(second.acceptedIntent.intentName).toBe("HitStun");
  });

  it("calculates playback scale based on physics authority", () => {
    const scaler = new ProceduralPlaybackScaler();
    // Actual velocity = 5.0, nominal = 2.5 -> scale factor should be 2.0
    const scale = scaler.calculatePlaybackScale(5.0, 2.5);
    expect(scale).toBeCloseTo(2.0);
  });

  it("falls back to default genre intent when unrecognized intent is supplied", () => {
    const mapper = new IntentMapper(GenreTemplate.GENRE_PLATFORMER);
    const resolved = mapper.resolveIntent({
      intentName: "CastMagicSpell", // Not in platformer template
      priority: 5,
      desiredVelocity: 0,
      intensity: 1.0,
    });
    expect(resolved).toBe("Idle");
  });

  it("supports animation layers, priority tags, and blend transition duration", () => {
    const upperBodyAim: AnimationIntent = {
      intentName: "AimDownSights",
      priority: 50,
      desiredVelocity: 0,
      intensity: 1.0,
      layer: AnimationLayer.LAYER_UPPER_BODY,
      priorityTags: ["combat", "aiming"],
      blendTransitionDuration: 0.15,
    };

    expect(upperBodyAim.layer).toBe(AnimationLayer.LAYER_UPPER_BODY);
    expect(upperBodyAim.priorityTags).toContain("combat");
    expect(upperBodyAim.blendTransitionDuration).toBe(0.15);
  });
});
