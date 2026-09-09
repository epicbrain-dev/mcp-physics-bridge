import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import * as protoLoader from "@grpc/proto-loader";
import * as grpc from "@grpc/grpc-js";
import path from "path";
import { fileURLToPath } from "url";
import { WebPhysicsWebSocketServer } from "../../src/network/websocket_server.js";
import { defaultConfig, BridgeConfig } from "../../src/config.js";
import { EngineMode, PhysicsStatusCode } from "../../src/proto/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_ROOT = path.resolve(__dirname, "../../proto");

describe("WebPhysicsWebSocketServer (Integration & CSWSH Defense)", () => {
  const testPort = 8089;
  const validToken = "secure-physics-token-999";
  const testConfig: BridgeConfig = {
    ...defaultConfig,
    wsPort: testPort,
    wsAuthToken: validToken,
  };

  let server: WebPhysicsWebSocketServer;
  let protoService: any;

  beforeAll(async () => {
    server = new WebPhysicsWebSocketServer(testConfig);
    await server.start();

    const pkgDef = await protoLoader.load(path.join(PROTO_ROOT, "physics_stream.proto"), {
      keepCase: false,
      longs: String,
      enums: Number,
      defaults: true,
      oneofs: true,
    });
    const loaded = grpc.loadPackageDefinition(pkgDef) as any;
    protoService = loaded.mcp.physics.PhysicsStreamingService.service;
  });

  afterAll(async () => {
    await server.stop();
  });

  it("reports server running and port status", () => {
    const status = server.getStatus();
    expect(status.isRunning).toBe(true);
    expect(status.port).toBe(testPort);
  });

  it("rejects connection without auth token (CSWSH defense) with code 1008", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/`);

    const closeResult = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    expect(closeResult.code).toBe(1008);
    expect(closeResult.reason).toContain("Unauthorized");
  });

  it("rejects connection with invalid auth token with code 1008", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/?token=wrong-token`);

    const closeResult = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    expect(closeResult.code).toBe(1008);
    expect(closeResult.reason).toContain("Unauthorized");
  });

  it("accepts connection with valid query param token and handles JSON 60 FPS frames", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/?token=${validToken}`);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", (err) => reject(err));
    });

    // Send valid frame
    const framePayload = {
      frameId: "2001",
      timestampNs: "16666666",
      deltaTime: 0.016,
      mode: EngineMode.PLAYTEST,
      entityIds: [10],
      posX: [0],
      posY: [0],
      posZ: [0],
      velX: [5],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };

    const responsePromise = new Promise<any>((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    ws.send(JSON.stringify(framePayload));
    const response = await responsePromise;

    expect(response.frameId).toBe("2001");
    expect(response.statusCode).toBe(PhysicsStatusCode.STATUS_OK);
    expect(response.frameErrorBitmask).toBe(0);

    // Send soft-clamped frame over WebSocket
    const clampedPayload = {
      frameId: "2002",
      timestampNs: "33333333",
      deltaTime: 0.016,
      mode: EngineMode.PLAYTEST,
      entityIds: [10],
      posX: [0],
      posY: [0],
      posZ: [0],
      velX: [100], // Exceeds 50.0
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };

    const clampedPromise = new Promise<any>((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    ws.send(JSON.stringify(clampedPayload));
    const clampedRes = await clampedPromise;

    expect(clampedRes.frameId).toBe("2002");
    expect(clampedRes.statusCode).toBe(PhysicsStatusCode.STATUS_SOFT_CLAMPED);
    expect(clampedRes.correctedFrame).toBeDefined();
    expect(clampedRes.correctedFrame.velX[0]).toBeCloseTo(50.0, 3);

    ws.close();
  });

  it("accepts connection with Authorization header and handles Debug Mode rejection", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/`, {
      headers: {
        Authorization: `Bearer ${validToken}`,
      },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", (err) => reject(err));
    });

    // Send frame in Debug Mode with NaN position
    const invalidFrame = {
      frameId: "3001",
      timestampNs: "33333333",
      deltaTime: 0.016,
      mode: EngineMode.DEBUG,
      entityIds: [99],
      posX: [NaN],
      posY: [0],
      posZ: [0],
      velX: [0],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };

    const responsePromise = new Promise<any>((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    ws.send(JSON.stringify(invalidFrame));
    const response = await responsePromise;

    expect(response.frameId).toBe("3001");
    expect(response.statusCode).toBe(PhysicsStatusCode.STATUS_NAN_DETECTED);
    expect(response.failingEntityIds).toContain(99);

    ws.close();
  });

  it("handles binary Protobuf frame transmission", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/?token=${validToken}`);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", (err) => reject(err));
    });

    const protoFrame = {
      frameId: "4001",
      timestampNs: "50000000",
      deltaTime: 0.016,
      mode: EngineMode.PLAYTEST,
      entityIds: [100],
      posX: [1],
      posY: [2],
      posZ: [3],
      velX: [0],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };

    const encodedReq = protoService.StreamPhysics.requestSerialize(protoFrame);

    const responsePromise = new Promise<any>((resolve) => {
      ws.once("message", (data, isBinary) => {
        expect(isBinary).toBe(true);
        const decoded = protoService.StreamPhysics.responseDeserialize(
          Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        );
        resolve(decoded);
      });
    });

    ws.send(encodedReq, { binary: true });
    const response = await responsePromise;

    expect(String(response.frameId)).toBe("4001");
    expect(response.statusCode).toBe(PhysicsStatusCode.STATUS_OK);

    ws.close();
  });
});
