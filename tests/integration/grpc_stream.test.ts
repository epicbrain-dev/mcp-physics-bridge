import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";
import { NativeEngineGrpcServer } from "../../src/network/grpc_server.js";
import { defaultConfig, BridgeConfig } from "../../src/config.js";
import { EngineMode, PhysicsStatusCode, AnimationLayer } from "../../src/proto/index.js";
import { createHash } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_ROOT = path.resolve(__dirname, "../../proto");

describe("NativeEngineGrpcServer (Full Integration)", () => {
  const testConfig: BridgeConfig = {
    ...defaultConfig,
    grpcPort: 50061,
  };

  let server: NativeEngineGrpcServer;
  let proto: any;
  let physicsClient: any;
  let aiHookClient: any;
  let animClient: any;

  beforeAll(async () => {
    server = new NativeEngineGrpcServer(testConfig);
    await server.start();

    const packageDefinition = await protoLoader.load(
      [
        path.join(PROTO_ROOT, "physics_stream.proto"),
        path.join(PROTO_ROOT, "ai_hooks.proto"),
        path.join(PROTO_ROOT, "animation_stream.proto"),
      ],
      {
        keepCase: false,
        longs: String,
        enums: Number,
        defaults: true,
        oneofs: true,
      }
    );
    proto = grpc.loadPackageDefinition(packageDefinition) as any;

    const endpoint = `127.0.0.1:${testConfig.grpcPort}`;
    physicsClient = new proto.mcp.physics.PhysicsStreamingService(
      endpoint,
      grpc.credentials.createInsecure()
    );
    aiHookClient = new proto.mcp.physics.AIHookService(
      endpoint,
      grpc.credentials.createInsecure()
    );
    animClient = new proto.mcp.physics.AnimationSynthesisService(
      endpoint,
      grpc.credentials.createInsecure()
    );
  });

  afterAll(async () => {
    physicsClient?.close();
    aiHookClient?.close();
    animClient?.close();
    await server.stop();
  });

  it("reports running status with correct port", () => {
    const status = server.getStatus();
    expect(status.isRunning).toBe(true);
    expect(status.port).toBe(testConfig.grpcPort);
  });

  it("handles bi-directional physics streaming (PhysicsStreamingService)", async () => {
    return new Promise<void>((resolve, reject) => {
      const stream = physicsClient.StreamPhysics();
      const receivedResponses: any[] = [];

      stream.on("data", (response: any) => {
        receivedResponses.push(response);
        if (receivedResponses.length === 2) {
          stream.end();
        }
      });

      stream.on("end", () => {
        try {
          expect(receivedResponses.length).toBe(2);

          // Frame 1: Normal valid frame in Playtest Mode
          const first = receivedResponses[0];
          expect(String(first.frameId)).toBe("1001");
          expect(first.statusCode).toBe(PhysicsStatusCode.STATUS_OK);
          expect(first.frameErrorBitmask).toBe(0);

          // Frame 2: Soft-clamped velocity in Playtest Mode
          const second = receivedResponses[1];
          expect(String(second.frameId)).toBe("1002");
          expect(second.statusCode).toBe(PhysicsStatusCode.STATUS_SOFT_CLAMPED);
          expect(second.failingEntityIds).toContain(1);
          expect(second.correctedFrame).toBeDefined();
          expect(Number(second.correctedFrame.velX[0])).toBeCloseTo(50.0, 3);

          resolve();
        } catch (err) {
          reject(err);
        }
      });

      stream.on("error", (err: any) => {
        reject(err);
      });

      // Send Frame 1: Healthy entities
      stream.write({
        frameId: "1001",
        timestampNs: "16000000",
        deltaTime: 0.016,
        mode: EngineMode.PLAYTEST,
        entityIds: [1, 2],
        posX: [0, 5],
        posY: [1, 1],
        posZ: [0, 0],
        velX: [1, 2],
        velY: [0, 0],
        velZ: [0, 0],
        rotX: [0, 0],
        rotY: [0, 0],
        rotZ: [0, 0],
        rotW: [1, 1],
      });

      // Send Frame 2: Entity with excessive linear velocity (> 50.0)
      stream.write({
        frameId: "1002",
        timestampNs: "32000000",
        deltaTime: 0.016,
        mode: EngineMode.PLAYTEST,
        entityIds: [1],
        posX: [10],
        posY: [1],
        posZ: [0],
        velX: [80], // Violates 50.0 limit
        velY: [0],
        velZ: [0],
        rotX: [0],
        rotY: [0],
        rotZ: [0],
        rotW: [1],
      });
    });
  });

  it("handles AIHookService.TriggerAIHook", async () => {
    return new Promise<void>((resolve, reject) => {
      aiHookClient.TriggerAIHook(
        {
          hookId: "hook-test-42",
          eventName: "OnEntityCollision",
          targetEntityId: 7,
          frameId: "500",
          contextJson: JSON.stringify({ impactSpeed: 12.5 }),
        },
        (err: any, response: any) => {
          if (err) return reject(err);
          try {
            expect(response.hookId).toBe("hook-test-42");
            expect(response.success).toBe(true);
            expect(response.diagnosticTrace).toBeDefined();
            expect(response.diagnosticTrace.sandboxExitCode).toBe(0);
            resolve();
          } catch (assertErr) {
            reject(assertErr);
          }
        }
      );
    });
  });

  it("handles AIHookService.DeployLogicModule with DualPayload verification", async () => {
    const source = "export function update(): void {}";
    const bytecode = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const validChecksum = createHash("sha256").update(source).digest("hex");

    // 1. Valid payload
    const validResult = await new Promise<any>((resolve, reject) => {
      aiHookClient.DeployLogicModule(
        {
          moduleId: "mod-kinematics-v1",
          assemblyscriptSource: source,
          wasmBytecode: bytecode,
          sourceChecksum: validChecksum,
          compilerVersion: "0.27.30",
          optimizationTarget: "release",
        },
        (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        }
      );
    });

    expect(validResult.success).toBe(true);
    expect(validResult.hookId).toBe("mod-kinematics-v1");
    expect(validResult.deployedModule.sourceChecksum).toBe(validChecksum);

    // 2. Corrupted checksum payload
    const invalidResult = await new Promise<any>((resolve, reject) => {
      aiHookClient.DeployLogicModule(
        {
          moduleId: "mod-corrupted",
          assemblyscriptSource: source,
          wasmBytecode: bytecode,
          sourceChecksum: "invalid-checksum-hash",
        },
        (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        }
      );
    });

    expect(invalidResult.success).toBe(false);
    expect(invalidResult.errorMessage).toContain("Checksum mismatch");
    expect(invalidResult.diagnosticTrace.errorCategory).toBe("VERIFICATION_FAILED");
  });

  it("handles AIHookService.ReportReflectiveFailure", async () => {
    const reportRes = await new Promise<any>((resolve, reject) => {
      aiHookClient.ReportReflectiveFailure(
        {
          moduleId: "mod-kinematics-v1",
          astDiff: "--- old\n+++ new",
          compressedErrorLogs: "Error: NaN velocity at frame 120",
          failedFrameId: "120",
        },
        (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        }
      );
    });

    expect(reportRes.success).toBe(true);
    expect(reportRes.hookId).toBe("mod-kinematics-v1");
  });

  it("handles bi-directional animation stream (AnimationSynthesisService)", async () => {
    return new Promise<void>((resolve, reject) => {
      const stream = animClient.StreamAnimationWeights();
      const states: any[] = [];

      stream.on("data", (state: any) => {
        states.push(state);
        if (states.length === 2) {
          stream.end();
        }
      });

      stream.on("end", () => {
        try {
          expect(states.length).toBe(2);

          // State 1: Walk intent
          const first = states[0];
          expect(first.activeIntent).toBe("Walk");
          expect(first.blendWeights.length).toBeGreaterThan(0);
          expect(first.playbackScale).toBeGreaterThan(0);
          expect(first.layer).toBe(AnimationLayer.LAYER_FULL_BODY);

          // State 2: Run intent (higher priority)
          const second = states[1];
          expect(second.activeIntent).toBe("Run");
          expect(second.arbitrationPreempted).toBe(true);

          resolve();
        } catch (err) {
          reject(err);
        }
      });

      stream.on("error", (err: any) => {
        reject(err);
      });

      // Write low-priority Walk intent
      stream.write({
        intentName: "Walk",
        priority: 1,
        desiredVelocity: 3.0,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_FULL_BODY,
      });

      // Write higher-priority Run intent
      stream.write({
        intentName: "Run",
        priority: 5,
        desiredVelocity: 6.0,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_FULL_BODY,
      });
    });
  });

  it("handles multi-layer concurrent streaming and preemption reasons (AnimationSynthesisService)", async () => {
    return new Promise<void>((resolve, reject) => {
      const stream = animClient.StreamAnimationWeights();
      const states: any[] = [];

      stream.on("data", (state: any) => {
        states.push(state);
        if (states.length === 2) {
          stream.end();
        }
      });

      stream.on("end", () => {
        try {
          expect(states.length).toBe(2);

          // State 1: Lower body locomotion
          const lower = states[0];
          expect(lower.layer).toBe(AnimationLayer.LAYER_LOWER_BODY);
          expect(lower.activeIntent).toBe("Run");
          expect(lower.arbitrationPreempted).toBe(false);

          // State 2: Upper body combat action (independent layer)
          const upper = states[1];
          expect(upper.layer).toBe(AnimationLayer.LAYER_UPPER_BODY);
          expect(upper.activeIntent).toBe("Interact");
          expect(upper.arbitrationPreempted).toBe(false);

          resolve();
        } catch (err) {
          reject(err);
        }
      });

      stream.on("error", (err: any) => {
        reject(err);
      });

      // Write LowerBody Run
      stream.write({
        entityId: 42,
        frameId: "5001",
        intentName: "Run",
        priority: 10,
        desiredVelocity: 6.0,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_LOWER_BODY,
      });

      // Write UpperBody Interact (should not conflict or preempt LowerBody)
      stream.write({
        entityId: 42,
        frameId: "5002",
        intentName: "Interact",
        priority: 15,
        desiredVelocity: 0.0,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_UPPER_BODY,
      });
    });
  });
});

