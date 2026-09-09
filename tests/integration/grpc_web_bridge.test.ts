import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import * as protoLoader from "@grpc/proto-loader";
import * as grpc from "@grpc/grpc-js";
import path from "path";
import { fileURLToPath } from "url";
import { GrpcWebBridge } from "../../src/network/grpc_web_bridge.js";
import { defaultConfig, BridgeConfig } from "../../src/config.js";
import { createHash } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_ROOT = path.resolve(__dirname, "../../proto");

describe("GrpcWebBridge (Integration & Protocol Splitting)", () => {
  const testPort = 50062;
  const testConfig: BridgeConfig = {
    ...defaultConfig,
    grpcWebPort: testPort,
  };

  let bridge: GrpcWebBridge;
  let protoService: any;

  beforeAll(async () => {
    bridge = new GrpcWebBridge(testConfig);
    await bridge.start();

    const pkgDef = await protoLoader.load(path.join(PROTO_ROOT, "ai_hooks.proto"), {
      keepCase: false,
      longs: String,
      enums: Number,
      defaults: true,
      oneofs: true,
    });
    const loaded = grpc.loadPackageDefinition(pkgDef) as any;
    protoService = loaded.mcp.physics.AIHookService.service;
  });

  afterAll(async () => {
    await bridge.stop();
  });

  it("reports running status with correct port", () => {
    const status = bridge.getStatus();
    expect(status.isRunning).toBe(true);
    expect(status.port).toBe(testPort);
  });

  it("handles CORS OPTIONS preflight request", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/mcp.physics.AIHookService/TriggerAIHook`, {
      method: "OPTIONS",
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("X-Grpc-Web");
  });

  it("dispatches TriggerAIHook via JSON gateway", async () => {
    const payload = {
      hookId: "web-hook-1",
      eventName: "OnPlayerJump",
      targetEntityId: 5,
      frameId: "600",
      contextJson: JSON.stringify({ height: 2.5 }),
    };

    const res = await fetch(`http://127.0.0.1:${testPort}/mcp.physics.AIHookService/TriggerAIHook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hookId).toBe("web-hook-1");
    expect(data.success).toBe(true);
    expect(data.diagnosticTrace).toBeDefined();
    expect(data.diagnosticTrace.consoleLogs.length).toBeGreaterThan(0);
  });

  it("dispatches DeployLogicModule via JSON gateway with verification", async () => {
    const source = "export function tick(): void {}";
    const validChecksum = createHash("sha256").update(source).digest("hex");
    const bytecodeBase64 = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).toString("base64");

    // 1. Valid deploy
    const resValid = await fetch(`http://127.0.0.1:${testPort}/mcp.physics.AIHookService/DeployLogicModule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moduleId: "web-mod-01",
        assemblyscriptSource: source,
        wasmBytecode: bytecodeBase64,
        sourceChecksum: validChecksum,
      }),
    });

    expect(resValid.status).toBe(200);
    const dataValid = await resValid.json();
    expect(dataValid.success).toBe(true);
    expect(dataValid.deployedModule.sourceChecksum).toBe(validChecksum);

    // 2. Corrupted checksum
    const resInvalid = await fetch(`http://127.0.0.1:${testPort}/mcp.physics.AIHookService/DeployLogicModule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moduleId: "web-mod-corrupt",
        assemblyscriptSource: source,
        wasmBytecode: bytecodeBase64,
        sourceChecksum: "bad-hash",
      }),
    });

    expect(resInvalid.status).toBe(200);
    const dataInvalid = await resInvalid.json();
    expect(dataInvalid.success).toBe(false);
    expect(dataInvalid.errorMessage).toContain("Checksum mismatch");
  });

  it("dispatches ReportReflectiveFailure via JSON gateway", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/mcp.physics.AIHookService/ReportReflectiveFailure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moduleId: "web-mod-01",
        astDiff: "--- before\n+++ after",
        compressedErrorLogs: "Stack overflow at frame 99",
        failedFrameId: "99",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("handles gRPC-Web framed binary request and response", async () => {
    const reqObj = {
      hookId: "web-proto-hook",
      eventName: "OnPowerUpCollected",
      targetEntityId: 12,
      frameId: "720",
      contextJson: "{}",
    };

    const protoBytes = protoService.TriggerAIHook.requestSerialize(reqObj);

    // Create 5-byte gRPC-Web prefix
    const header = Buffer.alloc(5);
    header.writeUInt8(0x00, 0);
    header.writeUInt32BE(protoBytes.length, 1);
    const framedPayload = Buffer.concat([header, protoBytes]);

    const res = await fetch(`http://127.0.0.1:${testPort}/mcp.physics.AIHookService/TriggerAIHook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/grpc-web+proto",
        "X-Grpc-Web": "1",
      },
      body: framedPayload,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/grpc-web+proto");
    expect(res.headers.get("grpc-status")).toBe("0");

    const resArrayBuffer = await res.arrayBuffer();
    const resBuffer = Buffer.from(resArrayBuffer);

    // Verify first frame is data frame
    expect(resBuffer.readUInt8(0)).toBe(0x00);
    const dataLen = resBuffer.readUInt32BE(1);
    const dataPayload = resBuffer.subarray(5, 5 + dataLen);

    const decodedRes = protoService.TriggerAIHook.responseDeserialize(dataPayload);
    expect(decodedRes.hookId).toBe("web-proto-hook");
    expect(decodedRes.success).toBe(true);

    // Verify second frame is trailer frame (0x80)
    const trailerOffset = 5 + dataLen;
    expect(resBuffer.readUInt8(trailerOffset)).toBe(0x80);
    const trailerLen = resBuffer.readUInt32BE(trailerOffset + 1);
    const trailerText = resBuffer.subarray(trailerOffset + 5, trailerOffset + 5 + trailerLen).toString("utf-8");
    expect(trailerText).toContain("grpc-status:0");
  });

  it("returns 404 for unknown service method", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/mcp.physics.UnknownService/UnknownMethod`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });

  it("returns 405 for unknown GET endpoint", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/mcp.physics.AIHookService/TriggerAIHook`, {
      method: "GET",
    });

    expect(res.status).toBe(405);
  });

  it("serves /healthz with HTTP 200 and service readiness payload", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("mcp-physics-bridge");
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(typeof body.requestsProcessed).toBe("number");
  });

  it("serves /metrics with standard Prometheus exposition format", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");

    const text = await res.text();
    expect(text).toContain("mcp_physics_requests_total");
    expect(text).toContain("mcp_physics_uptime_seconds");
    expect(text).toContain("mcp_physics_memory_heap_bytes");
  });
});
