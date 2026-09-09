import { describe, it, expect, beforeEach } from "vitest";
import {
  OptInWeightStreamer,
  LayeredWeightStreamer,
  BlendCurveType,
  evaluateBlendCurve,
} from "../../src/animation/weight_streamer.js";
import { AnimationLayer } from "../../src/proto/index.js";

describe("OptInWeightStreamer & LayeredWeightStreamer (Blend Curves & Normalization)", () => {
  describe("Mathematical Curve Evaluator (evaluateBlendCurve)", () => {
    it("evaluates LINEAR curve accurately", () => {
      expect(evaluateBlendCurve(0.0, BlendCurveType.LINEAR)).toBe(0.0);
      expect(evaluateBlendCurve(0.25, BlendCurveType.LINEAR)).toBe(0.25);
      expect(evaluateBlendCurve(0.5, BlendCurveType.LINEAR)).toBe(0.5);
      expect(evaluateBlendCurve(1.0, BlendCurveType.LINEAR)).toBe(1.0);
    });

    it("evaluates SMOOTHSTEP curve with S-curve ease-in ease-out", () => {
      // 3t^2 - 2t^3
      expect(evaluateBlendCurve(0.0, BlendCurveType.SMOOTHSTEP)).toBe(0.0);
      expect(evaluateBlendCurve(0.5, BlendCurveType.SMOOTHSTEP)).toBe(0.5);
      expect(evaluateBlendCurve(1.0, BlendCurveType.SMOOTHSTEP)).toBe(1.0);

      // S-curve property: slower rate of change near ends
      const atQuarter = evaluateBlendCurve(0.25, BlendCurveType.SMOOTHSTEP);
      expect(atQuarter).toBeLessThan(0.25); // ease-in
      const atThreeQuarters = evaluateBlendCurve(0.75, BlendCurveType.SMOOTHSTEP);
      expect(atThreeQuarters).toBeGreaterThan(0.75); // ease-out
    });

    it("evaluates S_CURVE (Quintic Smootherstep) with flatter tangents", () => {
      // 6t^5 - 15t^4 + 10t^3
      expect(evaluateBlendCurve(0.0, BlendCurveType.S_CURVE)).toBe(0.0);
      expect(evaluateBlendCurve(0.5, BlendCurveType.S_CURVE)).toBe(0.5);
      expect(evaluateBlendCurve(1.0, BlendCurveType.S_CURVE)).toBe(1.0);
      expect(evaluateBlendCurve(0.1, BlendCurveType.S_CURVE)).toBeLessThan(
        evaluateBlendCurve(0.1, BlendCurveType.SMOOTHSTEP)
      );
    });

    it("evaluates EXPONENTIAL and INSTANT curves", () => {
      expect(evaluateBlendCurve(0.0, BlendCurveType.EXPONENTIAL)).toBeCloseTo(0.0, 3);
      expect(evaluateBlendCurve(1.0, BlendCurveType.EXPONENTIAL)).toBeCloseTo(1.0, 3);
      expect(evaluateBlendCurve(0.1, BlendCurveType.INSTANT)).toBe(1.0);
    });
  });

  describe("OptInWeightStreamer Frame-by-Frame Blending", () => {
    let streamer: OptInWeightStreamer;

    beforeEach(() => {
      streamer = new OptInWeightStreamer("Idle", BlendCurveType.LINEAR);
    });

    it("starts with 100% weight on initial clip", () => {
      const weights = streamer.updateBlend(0.016);
      expect(weights.length).toBe(1);
      expect(weights[0].clipName).toBe("Idle");
      expect(weights[0].weight).toBe(1.0);
    });

    it("transitions between clips smoothly over specified duration with linear curve", () => {
      streamer.transitionTo("Walk", 0.2, BlendCurveType.LINEAR); // 0.2s duration

      // Frame 1: 0.1s elapsed (50% progress)
      const mid = streamer.updateBlend(0.1);
      expect(mid.length).toBe(2);

      const idleWeight = mid.find((w) => w.clipName === "Idle")?.weight ?? 0;
      const walkWeight = mid.find((w) => w.clipName === "Walk")?.weight ?? 0;
      expect(idleWeight).toBeCloseTo(0.5, 3);
      expect(walkWeight).toBeCloseTo(0.5, 3);
      expect(idleWeight + walkWeight).toBeCloseTo(1.0, 4);

      // Frame 2: another 0.1s elapsed (100% progress)
      const end = streamer.updateBlend(0.1);
      expect(end.length).toBe(1);
      expect(end[0].clipName).toBe("Walk");
      expect(end[0].weight).toBe(1.0);
    });

    it("enforces strict normalization invariant sum(weights) == 1.0 across all frames", () => {
      streamer.transitionTo("Run", 0.5, BlendCurveType.SMOOTHSTEP);

      for (let step = 0; step < 10; step++) {
        const weights = streamer.updateBlend(0.05);
        const sum = weights.reduce((acc, w) => acc + w.weight, 0);
        expect(sum).toBeCloseTo(1.0, 4);
      }
    });

    it("handles interrupted transitions gracefully (3-way crossfade)", () => {
      // Step 1: Start Idle -> Walk (duration 0.2s)
      streamer.transitionTo("Walk", 0.2, BlendCurveType.LINEAR);
      streamer.updateBlend(0.1); // At 50%: 0.5 Idle, 0.5 Walk

      // Step 2: Sudden interrupt to "Sprint" while Walk was still fading in!
      streamer.transitionTo("Sprint", 0.2, BlendCurveType.LINEAR);

      // Step 3: Advance time into new transition
      const mid = streamer.updateBlend(0.1);
      expect(mid.length).toBeGreaterThanOrEqual(2);

      // Sprint is ramping up
      const sprintWeight = mid.find((w) => w.clipName === "Sprint")?.weight ?? 0;
      expect(sprintWeight).toBeCloseTo(0.5, 3);

      // Total sum must remain strictly 1.0
      const sum = mid.reduce((acc, w) => acc + w.weight, 0);
      expect(sum).toBeCloseTo(1.0, 4);
    });

    it("resets to default clip cleanly", () => {
      streamer.transitionTo("Run", 0.2);
      streamer.updateBlend(0.1);
      streamer.reset("Idle");

      expect(streamer.getCurrentClip()).toBe("Idle");
      expect(streamer.getTargetClip()).toBe("Idle");
      expect(streamer.isTransitioning()).toBe(false);
      const weights = streamer.getCurrentWeights();
      expect(weights).toEqual([{ clipName: "Idle", weight: 1.0 }]);
    });
  });

  describe("LayeredWeightStreamer", () => {
    let layered: LayeredWeightStreamer;

    beforeEach(() => {
      layered = new LayeredWeightStreamer("Idle");
    });

    it("manages independent layers without cross-contamination", () => {
      // Lower body transitions to Run
      layered.transitionLayer(AnimationLayer.LAYER_LOWER_BODY, "Run", 0.2, BlendCurveType.LINEAR);

      // Upper body transitions to AimDownSights
      layered.transitionLayer(AnimationLayer.LAYER_UPPER_BODY, "AimDownSights", 0.1, BlendCurveType.LINEAR);

      // Advance by 0.1s
      layered.updateAll(0.1);

      const lowerWeights = layered.getStreamer(AnimationLayer.LAYER_LOWER_BODY).getCurrentWeights();
      const upperWeights = layered.getStreamer(AnimationLayer.LAYER_UPPER_BODY).getCurrentWeights();

      // Lower body at 50%
      expect(lowerWeights.find((w) => w.clipName === "Run")?.weight).toBeCloseTo(0.5, 3);

      // Upper body completed (0.1s duration reached)
      expect(upperWeights.find((w) => w.clipName === "AimDownSights")?.weight).toBeCloseTo(1.0, 3);
    });
  });
});
