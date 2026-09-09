import { describe, it, expect, beforeEach } from "vitest";
import { BridgeSideArbitrator } from "../../src/animation/arbitration.js";
import { AnimationIntent, AnimationLayer } from "../../src/proto/index.js";

describe("BridgeSideArbitrator (Action Priority & Multi-Layer Arbitration)", () => {
  let arbitrator: BridgeSideArbitrator;

  beforeEach(() => {
    arbitrator = new BridgeSideArbitrator();
  });

  describe("Basic Priority Preemption", () => {
    it("accepts candidate when no active intent is running", () => {
      const walkIntent: AnimationIntent = {
        intentName: "Walk",
        priority: 10,
        desiredVelocity: 2.5,
        intensity: 1.0,
      };

      const decision = arbitrator.arbitrate(walkIntent);
      expect(decision.acceptedIntent.intentName).toBe("Walk");
      expect(decision.preempted).toBe(false);
      expect(arbitrator.getActiveIntent()?.intentName).toBe("Walk");
    });

    it("preempts active intent when candidate has strictly higher priority", () => {
      arbitrator.arbitrate({
        intentName: "Walk",
        priority: 10,
        desiredVelocity: 2.5,
        intensity: 1.0,
      });

      const jumpIntent: AnimationIntent = {
        intentName: "Jump",
        priority: 30,
        desiredVelocity: 4.0,
        intensity: 1.0,
      };

      const decision = arbitrator.arbitrate(jumpIntent);
      expect(decision.preempted).toBe(true);
      expect(decision.acceptedIntent.intentName).toBe("Jump");
      expect(decision.preemptedReason).toContain("Jump");
      expect(decision.preemptedReason).toContain("candidate priority 30 > previous 10");
      expect(arbitrator.getActiveIntent()?.intentName).toBe("Jump");
    });

    it("rejects candidate when candidate has lower priority", () => {
      arbitrator.arbitrate({
        intentName: "HeavyAttack",
        priority: 50,
        desiredVelocity: 0.5,
        intensity: 1.0,
      });

      const walkCandidate: AnimationIntent = {
        intentName: "Walk",
        priority: 10,
        desiredVelocity: 2.5,
        intensity: 1.0,
      };

      const decision = arbitrator.arbitrate(walkCandidate);
      expect(decision.preempted).toBe(false);
      expect(decision.acceptedIntent.intentName).toBe("HeavyAttack");
      expect(decision.preemptedReason).toContain("Retained higher priority intent");
      expect(arbitrator.getActiveIntent()?.intentName).toBe("HeavyAttack");
    });

    it("respects tieBreakerNewestWins option when priorities are equal", () => {
      const defaultArbitrator = new BridgeSideArbitrator({ tieBreakerNewestWins: false });
      defaultArbitrator.arbitrate({ intentName: "Walk", priority: 10, desiredVelocity: 2.5, intensity: 1 });
      const samePriority = defaultArbitrator.arbitrate({ intentName: "Run", priority: 10, desiredVelocity: 6, intensity: 1 });
      expect(samePriority.preempted).toBe(false);
      expect(samePriority.acceptedIntent.intentName).toBe("Walk");

      const newestWinsArbitrator = new BridgeSideArbitrator({ tieBreakerNewestWins: true });
      newestWinsArbitrator.arbitrate({ intentName: "Walk", priority: 10, desiredVelocity: 2.5, intensity: 1 });
      const secondCandidate = newestWinsArbitrator.arbitrate({ intentName: "Run", priority: 10, desiredVelocity: 6, intensity: 1 });
      expect(secondCandidate.preempted).toBe(true);
      expect(secondCandidate.acceptedIntent.intentName).toBe("Run");
    });
  });

  describe("Priority Tags & Uninterruptible Actions", () => {
    it("blocks preemption when active intent has 'uninterruptible' tag", () => {
      const rollIntent: AnimationIntent = {
        intentName: "DodgeRoll",
        priority: 40,
        desiredVelocity: 8.0,
        intensity: 1.0,
        priorityTags: ["locomotion", "uninterruptible"],
      };
      arbitrator.arbitrate(rollIntent);

      const attackIntent: AnimationIntent = {
        intentName: "LightAttack",
        priority: 80, // Higher priority!
        desiredVelocity: 1.0,
        intensity: 1.0,
      };

      const decision = arbitrator.arbitrate(attackIntent);
      expect(decision.preempted).toBe(false);
      expect(decision.acceptedIntent.intentName).toBe("DodgeRoll");
      expect(decision.preemptedReason).toContain("uninterruptible");
    });

    it("allows emergency override tags to break uninterruptible actions", () => {
      arbitrator.arbitrate({
        intentName: "DodgeRoll",
        priority: 40,
        desiredVelocity: 8.0,
        intensity: 1.0,
        priorityTags: ["uninterruptible"],
      });

      const hitStunIntent: AnimationIntent = {
        intentName: "HitStun",
        priority: 90,
        desiredVelocity: 0,
        intensity: 1.0,
        priorityTags: ["hit_reaction"], // Override tag!
      };

      const decision = arbitrator.arbitrate(hitStunIntent);
      expect(decision.preempted).toBe(true);
      expect(decision.acceptedIntent.intentName).toBe("HitStun");
    });
  });

  describe("Multi-Layer Skeletal Arbitration", () => {
    it("arbitrates distinct layers independently", () => {
      const lowerBodyRun: AnimationIntent = {
        intentName: "Run",
        priority: 20,
        desiredVelocity: 7.0,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_LOWER_BODY,
      };

      const upperBodyAim: AnimationIntent = {
        intentName: "AimDownSights",
        priority: 50,
        desiredVelocity: 0,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_UPPER_BODY,
      };

      const lowerRes = arbitrator.arbitrate(lowerBodyRun);
      expect(lowerRes.acceptedIntent.intentName).toBe("Run");
      expect(lowerRes.layer).toBe(AnimationLayer.LAYER_LOWER_BODY);

      const upperRes = arbitrator.arbitrate(upperBodyAim);
      expect(upperRes.acceptedIntent.intentName).toBe("AimDownSights");
      expect(upperRes.layer).toBe(AnimationLayer.LAYER_UPPER_BODY);

      expect(arbitrator.getActiveIntent(AnimationLayer.LAYER_LOWER_BODY)?.intentName).toBe("Run");
      expect(arbitrator.getActiveIntent(AnimationLayer.LAYER_UPPER_BODY)?.intentName).toBe("AimDownSights");
    });

    it("handles fullBodyPreemptsAllLayers when configured", () => {
      const fullBodyArbitrator = new BridgeSideArbitrator({ fullBodyPreemptsAllLayers: true });

      fullBodyArbitrator.arbitrate({
        intentName: "Walk",
        priority: 10,
        desiredVelocity: 2,
        intensity: 1,
        layer: AnimationLayer.LAYER_LOWER_BODY,
      });

      fullBodyArbitrator.arbitrate({
        intentName: "Fire",
        priority: 15,
        desiredVelocity: 0,
        intensity: 1,
        layer: AnimationLayer.LAYER_UPPER_BODY,
      });

      // Death on FullBody with priority 100 should preempt both layers
      const deathIntent: AnimationIntent = {
        intentName: "Death",
        priority: 100,
        desiredVelocity: 0,
        intensity: 1,
        layer: AnimationLayer.LAYER_FULL_BODY,
      };

      const deathRes = fullBodyArbitrator.arbitrate(deathIntent);
      expect(deathRes.preempted).toBe(false); // First on FullBody track
      expect(fullBodyArbitrator.getActiveIntent(AnimationLayer.LAYER_LOWER_BODY)).toBeUndefined();
      expect(fullBodyArbitrator.getActiveIntent(AnimationLayer.LAYER_UPPER_BODY)).toBeUndefined();
      expect(fullBodyArbitrator.getActiveIntent(AnimationLayer.LAYER_FULL_BODY)?.intentName).toBe("Death");
    });
  });

  describe("Duration Tracking & Action Expiration", () => {
    it("expires one-shot actions after configured duration", () => {
      arbitrator.setActionDuration("LightAttack", 0.4); // 0.4 seconds

      arbitrator.arbitrate({
        intentName: "LightAttack",
        priority: 45,
        desiredVelocity: 1.0,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_FULL_BODY,
      });

      expect(arbitrator.getActiveIntent()?.intentName).toBe("LightAttack");

      // Advance by 0.2s: should still be active
      let expired = arbitrator.advanceTime(0.2);
      expect(expired).toEqual([]);
      expect(arbitrator.getActiveIntent()?.intentName).toBe("LightAttack");

      // Advance by another 0.25s (total 0.45s): should expire
      expired = arbitrator.advanceTime(0.25);
      expect(expired).toContain(AnimationLayer.LAYER_FULL_BODY);
      expect(arbitrator.getActiveIntent()).toBeUndefined();
    });

    it("resets active intent on specific layer or all layers", () => {
      arbitrator.arbitrate({ intentName: "Walk", priority: 10, desiredVelocity: 2, intensity: 1, layer: AnimationLayer.LAYER_LOWER_BODY });
      arbitrator.arbitrate({ intentName: "Aim", priority: 10, desiredVelocity: 0, intensity: 1, layer: AnimationLayer.LAYER_UPPER_BODY });

      arbitrator.reset(AnimationLayer.LAYER_LOWER_BODY);
      expect(arbitrator.getActiveIntent(AnimationLayer.LAYER_LOWER_BODY)).toBeUndefined();
      expect(arbitrator.getActiveIntent(AnimationLayer.LAYER_UPPER_BODY)?.intentName).toBe("Aim");

      arbitrator.reset();
      expect(arbitrator.getActiveIntent(AnimationLayer.LAYER_UPPER_BODY)).toBeUndefined();
    });
  });
});
