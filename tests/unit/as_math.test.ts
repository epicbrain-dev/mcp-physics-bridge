import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("AssemblyScript Native Math Library (Sandbox WebAssembly Execution)", () => {
  let wasmExports: any;

  beforeAll(async () => {
    const wasmPath = path.resolve(process.cwd(), "build/release.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const mod = await WebAssembly.instantiate(wasmBytes, {
      env: { abort: () => {} },
    });
    wasmExports = mod.instance.exports;
  });

  describe("Vector3 Math Operations", () => {
    it("computes accurate dot products in Wasm", () => {
      const dot = wasmExports.vector3_dot(1, 2, 3, 4, -5, 6);
      expect(dot).toBe(12);
    });

    it("computes orthogonal vector dot product as zero", () => {
      const dot = wasmExports.vector3_dot(1, 0, 0, 0, 1, 0);
      expect(dot).toBe(0);
    });

    it("computes 3D Euclidean distance between two points", () => {
      const dist = wasmExports.vector3_distance(0, 0, 0, 3, 4, 0);
      expect(dist).toBeCloseTo(5.0, 4);
    });

    it("computes vector length/magnitude correctly", () => {
      const len = wasmExports.vector3_length(0, 3, 4);
      expect(len).toBeCloseTo(5.0, 4);
    });
  });

  describe("Quaternion Rotation Operations", () => {
    it("rotates a vector by 90 degrees around the Y axis", () => {
      // 90 deg around Y: axis=(0,1,0), angle=PI/2 -> q=(0, sin(PI/4), 0, cos(PI/4))
      const s = Math.sin(Math.PI / 4);
      const c = Math.cos(Math.PI / 4);

      // Rotating vector (1, 0, 0) should yield (0, 0, -1)
      const rx = wasmExports.quaternion_rotateVector_x(0, s, 0, c, 1, 0, 0);
      const ry = wasmExports.quaternion_rotateVector_y(0, s, 0, c, 1, 0, 0);
      const rz = wasmExports.quaternion_rotateVector_z(0, s, 0, c, 1, 0, 0);

      expect(rx).toBeCloseTo(0.0, 4);
      expect(ry).toBeCloseTo(0.0, 4);
      expect(rz).toBeCloseTo(-1.0, 4);
    });

    it("rotates a vector by 180 degrees around the Z axis", () => {
      // 180 deg around Z: axis=(0,0,1), angle=PI -> q=(0, 0, sin(PI/2), cos(PI/2)) = (0, 0, 1, 0)
      const rx = wasmExports.quaternion_rotateVector_x(0, 0, 1, 0, 1, 0, 0);
      const ry = wasmExports.quaternion_rotateVector_y(0, 0, 1, 0, 1, 0, 0);
      const rz = wasmExports.quaternion_rotateVector_z(0, 0, 1, 0, 1, 0, 0);

      expect(rx).toBeCloseTo(-1.0, 4);
      expect(ry).toBeCloseTo(0.0, 4);
      expect(rz).toBeCloseTo(0.0, 4);
    });
  });

  describe("Physics Integration Formulas", () => {
    it("calculates acceleration and velocity via calculateVelocity", () => {
      // initialVel = 0, force = 20, mass = 2, dt = 0.5 -> a = 10, vel = 5
      const vel = wasmExports.calculateVelocity(0, 20, 2, 0.5);
      expect(vel).toBe(5);
    });

    it("preserves velocity if mass is zero or negative", () => {
      const vel = wasmExports.calculateVelocity(15, 20, 0, 0.5);
      expect(vel).toBe(15);
    });

    it("clamps velocity within symmetric bounds", () => {
      expect(wasmExports.clampVelocity(15, 10)).toBe(10);
      expect(wasmExports.clampVelocity(-15, 10)).toBe(-10);
      expect(wasmExports.clampVelocity(7, 10)).toBe(7);
    });

    it("integrates 1D motion over time", () => {
      // pos = 10, vel = 4, dt = 0.5 -> 12
      expect(wasmExports.integrate1D(10, 4, 0.5)).toBe(12);
    });

    it("computes Euler step accurately", () => {
      // pos = 0, vel = 0, force = 10, mass = 2, dt = 0.5
      // newVel = 0 + (10 / 2) * 0.5 = 2.5
      // newPos = 0 + 2.5 * 0.5 = 1.25
      const newPos = wasmExports.step_euler(0, 0, 10, 2, 0.5);
      expect(newPos).toBe(1.25);
    });
  });
});

