import { describe, it, expect, beforeEach } from "vitest";
import { ProceduralPlaybackScaler } from "../../src/animation/root_motion.js";

describe("ProceduralPlaybackScaler (Root Motion Physics Authority)", () => {
  let scaler: ProceduralPlaybackScaler;

  beforeEach(() => {
    scaler = new ProceduralPlaybackScaler();
  });

  describe("Scalar Velocity Scaling & Clamping", () => {
    it("calculates accurate playback scale s = v_actual / v_nominal", () => {
      // Nominal Walk = 2.5 m/s, actual physics = 5.0 m/s -> scale = 2.0
      const scale = scaler.calculatePlaybackScale(5.0, 2.5);
      expect(scale).toBeCloseTo(2.0);
    });

    it("clamps minimum scale to prevent freezing (default 0.2)", () => {
      // Very slow creeping physics velocity
      const scale = scaler.calculatePlaybackScale(0.1, 5.0);
      expect(scale).toBeCloseTo(0.2);
    });

    it("clamps maximum scale to prevent hyper-speed jitter (default 3.0)", () => {
      // Extremely high blast force velocity
      const scale = scaler.calculatePlaybackScale(100.0, 2.5);
      expect(scale).toBeCloseTo(3.0);
    });

    it("returns 1.0 when nominal velocity is zero or negligible", () => {
      expect(scaler.calculatePlaybackScale(5.0, 0)).toBe(1.0);
      expect(scaler.calculatePlaybackScale(0, 0)).toBe(1.0);
    });
  });

  describe("3D Vector Decomposition & Planar Velocity", () => {
    it("isolates planar velocity (X-Z) when planarOnly is true, ignoring vertical fall speed", () => {
      // Vector with horizontal speed (3, 4) -> mag = 5.0, but vertical Y = 25 (falling or jumping)
      const vel = { x: 3.0, y: 25.0, z: 4.0 };
      const nominalWalk = 2.5;

      const planarScale = scaler.calculatePlaybackScale(vel, nominalWalk, 0.2, 3.0, true);
      // Horizontal mag = 5.0 / 2.5 = 2.0
      expect(planarScale).toBeCloseTo(2.0);

      const full3dScale = scaler.calculatePlaybackScale(vel, nominalWalk, 0.2, 15.0, false);
      // Full 3D mag = sqrt(9 + 625 + 16) = sqrt(650) ≈ 25.495 / 2.5 ≈ 10.198
      expect(full3dScale).toBeGreaterThan(10.0);
    });
  });

  describe("Temporal EMA Low-Pass Smoothing", () => {
    it("smooths abrupt velocity spikes over sequential frames", () => {
      const entityId = 42;
      const nominalVel = 2.5;

      // Frame 1: Normal walk
      const scale1 = scaler.calculateSmoothedScale(entityId, 2.5, nominalVel, {
        smoothingFactor: 0.3,
      });
      expect(scale1).toBeCloseTo(1.0);

      // Frame 2: Sudden explosive impulse (physics collision) to 10 m/s (target scale = 3.0 clamped)
      const scale2 = scaler.calculateSmoothedScale(entityId, 10.0, nominalVel, {
        smoothingFactor: 0.3,
      });
      // Should ramp smoothly: alpha * target + (1 - alpha) * prev = 0.3 * 3.0 + 0.7 * 1.0 = 1.6
      expect(scale2).toBeCloseTo(1.6, 2);
      expect(scale2).toBeLessThan(3.0);

      // Frame 3: Continued high speed
      const scale3 = scaler.calculateSmoothedScale(entityId, 10.0, nominalVel, {
        smoothingFactor: 0.3,
      });
      // 0.3 * 3.0 + 0.7 * 1.6 = 2.02
      expect(scale3).toBeCloseTo(2.02, 2);
    });

    it("resets smoothing state per entity", () => {
      const entityId = 10;
      scaler.calculateSmoothedScale(entityId, 10.0, 2.5);
      scaler.reset(entityId);

      // After reset, fresh scale evaluation starts unanchored to previous history
      const freshScale = scaler.calculateSmoothedScale(entityId, 2.5, 2.5);
      expect(freshScale).toBeCloseTo(1.0);
    });
  });

  describe("Angular Turn Rate Scaling & Foot Sliding Metrics", () => {
    it("calculates angular turn rate scaling", () => {
      // Actual turn rate = PI rad/s, nominal = PI/2 rad/s -> scale = 2.0
      const angularScale = scaler.calculateAngularScale(Math.PI, Math.PI / 2);
      expect(angularScale).toBeCloseTo(2.0);
    });

    it("evaluates foot sliding metric as 0.0 when displacement matches nominal stride", () => {
      const metric = scaler.calculateFootSlidingMetric(0.5, 0.5);
      expect(metric).toBeCloseTo(0.0);
    });

    it("evaluates foot sliding metric > 0 when actual displacement differs from stride", () => {
      // Skating forward: physics moved 1.0m, animation only stepped 0.5m
      const metric = scaler.calculateFootSlidingMetric(1.0, 0.5);
      expect(metric).toBeCloseTo(0.5); // (1.0 - 0.5) / 1.0 = 0.5
    });
  });
});
