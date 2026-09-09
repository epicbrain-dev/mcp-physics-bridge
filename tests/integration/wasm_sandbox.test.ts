import { describe, it, expect } from "vitest";
import { WasmContainer } from "../../src/sandbox/wasm_container.js";
import { InMemoryAssemblyScriptCompiler } from "../../src/sandbox/compiler.js";
import { DualPayloadVerifier } from "../../src/sandbox/dual_payload.js";
import { defaultConfig } from "../../src/config.js";

describe("WasmContainer (Sandbox Memory & Execution Integration)", () => {
  const compiler = new InMemoryAssemblyScriptCompiler();
  const verifier = new DualPayloadVerifier();

  it("guards against uninitialized execution", () => {
    const container = new WasmContainer(defaultConfig);
    const result = container.execute("calculateVelocity", 0, 10, 1, 0.016);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Wasm instance is not initialized");
  });

  it("performs full end-to-end compilation, verification, and sandboxed execution", async () => {
    const source = `
      import { Vector3 } from "./math/vector3";

      export function computeForceMagnitude(fx: f32, fy: f32, fz: f32): f32 {
        const force = new Vector3(fx, fy, fz);
        return force.length();
      }

      export function stepPhysics(pos: f32, vel: f32, dt: f32): f32 {
        return pos + vel * dt;
      }
    `;

    // 1. Compile in-memory
    const { module, compilation } = await compiler.compileModule("sandbox-e2e-01", source);
    expect(compilation.success).toBe(true);
    expect(module).toBeDefined();

    // 2. Verify dual payload
    const verification = verifier.verify(module!);
    expect(verification.valid).toBe(true);

    // 3. Load into Wasm sandbox container
    const container = new WasmContainer(defaultConfig);
    const loaded = await container.loadBytecode(module!.wasmBytecode);
    expect(loaded).toBe(true);

    // 4. Verify exported functions
    const exports = container.getExportedFunctions();
    expect(exports).toContain("computeForceMagnitude");
    expect(exports).toContain("stepPhysics");

    // 5. Execute sandboxed functions
    const forceResult = container.execute("computeForceMagnitude", 0, 3, 4);
    expect(forceResult.success).toBe(true);
    expect(forceResult.returnValue).toBeCloseTo(5.0, 4);
    expect(forceResult.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(forceResult.memoryBytesUsed).toBeGreaterThan(0);

    const stepResult = container.execute("stepPhysics", 100, 20, 0.5);
    expect(stepResult.success).toBe(true);
    expect(stepResult.returnValue).toBe(110);
  });

  it("safely handles execution of non-existent exported functions", async () => {
    const source = `export function existingFn(): f32 { return 42.0; }`;
    const compilation = await compiler.compileSource(source);
    expect(compilation.success).toBe(true);

    const container = new WasmContainer(defaultConfig);
    await container.loadBytecode(compilation.wasmBytes!);

    const result = container.execute("nonExistentFunction");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Exported function 'nonExistentFunction' not found");
  });

  it("captures assertion aborts cleanly without crashing the host", async () => {
    const source = `
      export function safeDivide(numerator: f32, denominator: f32): f32 {
        assert(denominator != 0.0, "Division by zero is forbidden");
        return numerator / denominator;
      }
    `;

    const compilation = await compiler.compileSource(source, { runtime: "stub" });
    expect(compilation.success).toBe(true);

    const container = new WasmContainer(defaultConfig);
    await container.loadBytecode(compilation.wasmBytes!);

    // Valid call
    const validResult = container.execute("safeDivide", 10, 2);
    expect(validResult.success).toBe(true);
    expect(validResult.returnValue).toBe(5);

    // Abort call (denominator = 0)
    const abortResult = container.execute("safeDivide", 10, 0);
    expect(abortResult.success).toBe(false);
    expect(abortResult.error).toContain("Abort");
    expect(container.getLastAbort()).not.toBeNull();
  });

  it("enforces execution timeout threshold", async () => {
    const source = `
      export function heavyLoop(): f32 {
        let sum: f32 = 0.0;
        for (let i = 0; i < 1000000; i++) {
          sum += f32(i);
        }
        return sum;
      }
    `;

    const compilation = await compiler.compileSource(source);
    expect(compilation.success).toBe(true);

    // Configure an ultra-strict timeout (0.0001 ms)
    const strictConfig = {
      ...defaultConfig,
      wasmExecutionTimeoutMs: 0.0001,
    };

    const container = new WasmContainer(strictConfig);
    await container.loadBytecode(compilation.wasmBytes!);

    const result = container.execute("heavyLoop");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Execution exceeded timeout threshold");
  });

  it("inspects memory usage within max pages limit", async () => {
    const source = `export function getConst(): f32 { return 1.0; }`;
    const compilation = await compiler.compileSource(source);

    const container = new WasmContainer(defaultConfig);
    await container.loadBytecode(compilation.wasmBytes!);

    const memUsage = container.getMemoryUsage();
    expect(memUsage.bytesUsed).toBeGreaterThan(0);
    expect(memUsage.pages).toBeGreaterThanOrEqual(1);
    expect(memUsage.pages).toBeLessThanOrEqual(defaultConfig.maxWasmMemoryPages);
  });
});

