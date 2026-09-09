import { describe, it, expect } from "vitest";
import { ReflectiveMemoryPipeline } from "../../src/sandbox/reflective_memory.js";

describe("ReflectiveMemoryPipeline (AST Diffing & Error Compression)", () => {
  it("records and retrieves failure history per module", () => {
    const pipeline = new ReflectiveMemoryPipeline();

    pipeline.recordFailure(
      "physics-mod-1",
      "export function step(): void {}",
      "ERROR: velocity clamped to max",
      100n
    );

    const history = pipeline.getHistory("physics-mod-1");
    expect(history.length).toBe(1);
    expect(history[0].moduleId).toBe("physics-mod-1");
    expect(history[0].failedFrameId).toBe(100n);

    pipeline.clearHistory("physics-mod-1");
    expect(pipeline.getHistory("physics-mod-1").length).toBe(0);
  });

  it("identifies structural semantic AST changes (added, removed, and modified functions)", () => {
    const pipeline = new ReflectiveMemoryPipeline();

    const previousSource = `
      export function calculateForce(mass: f32, accel: f32): f32 {
        return mass * accel;
      }

      export function legacyHelper(): void {
        // old code
      }
    `;

    const currentSource = `
      export function calculateForce(mass: f32, accel: f32): f32 {
        const adjustedAccel = accel * 0.98;
        return mass * adjustedAccel;
      }

      export function newClampHelper(v: f32): f32 {
        return v;
      }
    `;

    const diff = pipeline.generateAstDiff(previousSource, currentSource);

    expect(diff.structuralSummary).toContain("- Function 'legacyHelper' removed");
    expect(diff.structuralSummary).toContain("+ Function 'newClampHelper");
    expect(diff.structuralSummary).toContain("~ Function 'calculateForce' body modified");
    expect(diff.unifiedDiff).toContain("--- Previous Failing Logic");
    expect(diff.unifiedDiff).toContain("+++ Current Logic");
  });

  it("compresses noisy error logs and strips internal runtime stack traces", () => {
    const pipeline = new ReflectiveMemoryPipeline();

    const rawErrorLog = `
      ERROR TS2322: Type 'string' is not assignable to type 'f32'.
      at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
      at async executeStep (internal/vm/runtime.js:120:10)
      at async NativeGrpcServer (src/network/grpc_server.ts:200:15)
      WARNING: Soft clamp triggered on frame 42
      Assertion failed at line 14: velocity must not be NaN
      at Module.execute (node_modules/assemblyscript/asc.js:450:20)
    `;

    const compressed = pipeline.compressErrorLogs(rawErrorLog, 5);

    expect(compressed).toContain("ERROR TS2322: Type 'string'");
    expect(compressed).toContain("WARNING: Soft clamp triggered on frame 42");
    expect(compressed).toContain("Assertion failed at line 14");
    expect(compressed).not.toContain("processTicksAndRejections");
    expect(compressed).toContain("internal stack trace lines compressed");
  });

  it("generates a complete ReflectiveMemoryReport and formats AI prompt feedback", () => {
    const pipeline = new ReflectiveMemoryPipeline();

    const failingSource = `
      export function applyGravity(vel: f32): f32 {
        return vel - 999.0;
      }
    `;

    pipeline.recordFailure(
      "gravity-controller",
      failingSource,
      "ERROR: Excessive velocity divergence exceeding clamp threshold\nAssertion failed: vel < -100.0",
      512n
    );

    const newSource = `
      export function applyGravity(vel: f32, dt: f32): f32 {
        return vel - 9.8 * dt;
      }
    `;

    const report = pipeline.generateReflectiveReport("gravity-controller", newSource);
    expect(report).not.toBeNull();
    expect(report!.moduleId).toBe("gravity-controller");
    expect(report!.failedFrameId).toBe(512n);
    expect(report!.compressedErrorLogs).toContain("Excessive velocity divergence");

    const feedbackPrompt = pipeline.formatPromptFeedback(report!);
    expect(feedbackPrompt).toContain("### Reflective Memory Feedback for Module 'gravity-controller'");
    expect(feedbackPrompt).toContain("Failed on Frame: 512");
    expect(feedbackPrompt).toContain("applyGravity");
  });

  it("returns null when generating report for non-existent module", () => {
    const pipeline = new ReflectiveMemoryPipeline();
    const report = pipeline.generateReflectiveReport("unknown-mod", "export function foo(): void {}");
    expect(report).toBeNull();
  });
});
