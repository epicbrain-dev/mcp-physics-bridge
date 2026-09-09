import { describe, it, expect } from "vitest";
import { InMemoryAssemblyScriptCompiler } from "../../src/sandbox/compiler.js";

describe("InMemoryAssemblyScriptCompiler (In-Memory Compilation Pipeline)", () => {
  const compiler = new InMemoryAssemblyScriptCompiler();

  it("compiles valid AssemblyScript physics script to WebAssembly bytecode in-memory", async () => {
    const source = `
      export function stepVelocity(vel: f32, accel: f32, dt: f32): f32 {
        return vel + accel * dt;
      }
    `;

    const result = await compiler.compileSource(source);

    expect(result.success).toBe(true);
    expect(result.wasmBytes).toBeDefined();
    expect(result.wasmBytes!.byteLength).toBeGreaterThan(0);
    expect(result.compilationTimeMs).toBeGreaterThan(0);

    // Verify bytecode execution
    const mod = await WebAssembly.instantiate(result.wasmBytes!, {
      env: { abort: () => {} },
    });
    const stepVelocity = mod.instance.exports.stepVelocity as (v: number, a: number, dt: number) => number;
    expect(stepVelocity(10, 5, 2)).toBe(20);
  });

  it("seamlessly bundles and imports native Vector3 library into AI logic", async () => {
    const source = `
      import { Vector3 } from "./math/vector3";

      export function computeDistance(x1: f32, y1: f32, z1: f32, x2: f32, y2: f32, z2: f32): f32 {
        const p1 = new Vector3(x1, y1, z1);
        const p2 = new Vector3(x2, y2, z2);
        return p1.distance(p2);
      }
    `;

    const result = await compiler.compileSource(source);

    expect(result.success).toBe(true);
    expect(result.wasmBytes).toBeDefined();

    const mod = await WebAssembly.instantiate(result.wasmBytes!, {
      env: { abort: () => {} },
    });
    const computeDistance = mod.instance.exports.computeDistance as (
      x1: number, y1: number, z1: number,
      x2: number, y2: number, z2: number
    ) => number;

    const dist = computeDistance(0, 0, 0, 3, 4, 0);
    expect(dist).toBeCloseTo(5.0, 4);
  });

  it("seamlessly bundles and imports native Quaternion library for rotations", async () => {
    const source = `
      import { Quaternion } from "./math/quaternion";
      import { Vector3 } from "./math/vector3";

      export function rotateAroundY(vx: f32, vy: f32, vz: f32, angleRad: f32): f32 {
        const v = new Vector3(vx, vy, vz);
        const q = Quaternion.fromAxisAngle(Vector3.up(), angleRad);
        const rotated = q.rotateVector(v);
        return rotated.z;
      }
    `;

    const result = await compiler.compileSource(source);

    expect(result.success).toBe(true);
    expect(result.wasmBytes).toBeDefined();

    const mod = await WebAssembly.instantiate(result.wasmBytes!, {
      env: { abort: () => {} },
    });
    const rotateAroundY = mod.instance.exports.rotateAroundY as (
      vx: number, vy: number, vz: number, angle: number
    ) => number;

    // 90 deg around Y: (1, 0, 0) -> z = -1
    const zResult = rotateAroundY(1, 0, 0, Math.PI / 2);
    expect(zResult).toBeCloseTo(-1.0, 4);
  });

  it("reports diagnostic errors on syntax and type errors without throwing", async () => {
    const brokenSource = `
      export function badLogic(): f32 {
        const str: string = "unsupported float conversion";
        return str;
      }
    `;

    const result = await compiler.compileSource(brokenSource);

    expect(result.success).toBe(false);
    expect(result.wasmBytes).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) => d.includes("ERROR") || d.includes("Type"))).toBe(true);
  });

  it("handles empty source code safely", async () => {
    const result = await compiler.compileSource("   ");
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContain("Empty source code provided");
  });

  it("compiles and outputs DualPayloadModule with SHA-256 checksum", async () => {
    const source = `
      export function addImpulse(mass: f32, force: f32): f32 {
        if (mass <= 0.0) return 0.0;
        return force / mass;
      }
    `;

    const { module, compilation } = await compiler.compileModule("test-impulse-01", source);

    expect(compilation.success).toBe(true);
    expect(module).toBeDefined();
    expect(module!.moduleId).toBe("test-impulse-01");
    expect(module!.assemblyscriptSource).toBe(source);
    expect(module!.sourceChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(module!.wasmBytecode.byteLength).toBeGreaterThan(0);
  });
});
