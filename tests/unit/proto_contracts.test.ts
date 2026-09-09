import { describe, it, expect } from "vitest";
import * as protoLoader from "@grpc/proto-loader";
import * as grpc from "@grpc/grpc-js";
import path from "path";
import { fileURLToPath } from "url";
import {
  PhysicsErrorBitmask,
  AnimationLayer,
  GenreTemplate,
  EngineMode,
  PhysicsStatusCode,
  DiagnosticTrace,
  DualPayloadModule,
} from "../../src/proto/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_ROOT = path.resolve(__dirname, "../../proto");

describe("Protobuf Contracts & Wire Schemas", () => {
  it("successfully loads physics_stream.proto via proto-loader", async () => {
    const pkgDef = await protoLoader.load(path.join(PROTO_ROOT, "physics_stream.proto"), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const loadedPkg = grpc.loadPackageDefinition(pkgDef) as any;
    expect(loadedPkg.mcp.physics.PhysicsStreamingService).toBeDefined();
    expect(loadedPkg.mcp.physics.PhysicsFrameSoA).toBeDefined();
    expect(loadedPkg.mcp.physics.PhysicsValidationResponse).toBeDefined();
    expect(loadedPkg.mcp.physics.PhysicsErrorBitmask).toBeDefined();
  });

  it("successfully loads ai_hooks.proto via proto-loader", async () => {
    const pkgDef = await protoLoader.load(path.join(PROTO_ROOT, "ai_hooks.proto"), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const loadedPkg = grpc.loadPackageDefinition(pkgDef) as any;
    expect(loadedPkg.mcp.physics.AIHookService).toBeDefined();
    expect(loadedPkg.mcp.physics.DiagnosticTrace).toBeDefined();
    expect(loadedPkg.mcp.physics.DualPayloadModule).toBeDefined();
    expect(loadedPkg.mcp.physics.ReflectiveMemoryReport).toBeDefined();
  });

  it("successfully loads animation_stream.proto via proto-loader", async () => {
    const pkgDef = await protoLoader.load(path.join(PROTO_ROOT, "animation_stream.proto"), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const loadedPkg = grpc.loadPackageDefinition(pkgDef) as any;
    expect(loadedPkg.mcp.physics.AnimationSynthesisService).toBeDefined();
    expect(loadedPkg.mcp.physics.AnimationLayer).toBeDefined();
    expect(loadedPkg.mcp.physics.AnimationIntent).toBeDefined();
    expect(loadedPkg.mcp.physics.SynthesizedAnimationState).toBeDefined();
  });

  it("verifies PhysicsErrorBitmask discrete binary flag values", () => {
    expect(PhysicsErrorBitmask.ERROR_NONE).toBe(0);
    expect(PhysicsErrorBitmask.ERROR_NAN_OR_INF).toBe(1 << 0);
    expect(PhysicsErrorBitmask.ERROR_OUT_OF_BOUNDS).toBe(1 << 1);
    expect(PhysicsErrorBitmask.ERROR_LINEAR_VEL_EXCEEDED).toBe(1 << 2);
    expect(PhysicsErrorBitmask.ERROR_ANGULAR_VEL_EXCEEDED).toBe(1 << 3);
    expect(PhysicsErrorBitmask.ERROR_ROTATION_UNNORMALIZED).toBe(1 << 4);
    expect(PhysicsErrorBitmask.ERROR_COLLISION_PENETRATION).toBe(1 << 5);
    expect(PhysicsErrorBitmask.ERROR_DIVERGENCE_SNAP).toBe(1 << 6);
    expect(PhysicsErrorBitmask.ERROR_TIME_DILATED).toBe(1 << 7);
    expect(PhysicsErrorBitmask.ERROR_STRICT_REJECTED).toBe(1 << 8);
  });

  it("verifies DiagnosticTrace and DualPayloadModule typing", () => {
    const trace: DiagnosticTrace = {
      executionTimeNs: 1250000n,
      compileTimeNs: 850000n,
      memoryBytesUsed: 65536,
      instructionsExecuted: 4200n,
      cacheHit: true,
      sandboxExitCode: 0,
      consoleLogs: ["[Wasm] Step executed successfully"],
      errorCategory: "NONE",
    };

    const payload: DualPayloadModule = {
      moduleId: "mod-test-01",
      assemblyscriptSource: "export function step(): void {}",
      wasmBytecode: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
      sourceChecksum: "abc123hash",
      compilerVersion: "0.27.30",
      optimizationTarget: "release",
    };

    expect(trace.instructionsExecuted).toBe(4200n);
    expect(payload.compilerVersion).toBe("0.27.30");
    expect(payload.optimizationTarget).toBe("release");
  });

  it("verifies AnimationLayer and GenreTemplate constants", () => {
    expect(AnimationLayer.LAYER_FULL_BODY).toBe(0);
    expect(AnimationLayer.LAYER_LOWER_BODY).toBe(1);
    expect(AnimationLayer.LAYER_UPPER_BODY).toBe(2);
    expect(AnimationLayer.LAYER_ADDITIVE).toBe(3);

    expect(GenreTemplate.GENRE_GENERIC).toBe(0);
    expect(GenreTemplate.GENRE_PLATFORMER).toBe(1);
    expect(GenreTemplate.GENRE_FPS).toBe(2);
    expect(GenreTemplate.GENRE_ACTION_RPG).toBe(3);
    expect(GenreTemplate.GENRE_VEHICLE).toBe(4);
  });
});
