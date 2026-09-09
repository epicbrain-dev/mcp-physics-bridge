import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PhysicsBridgeService } from "../../src/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BridgeConfig, defaultConfig } from "../../src/config.js";
import { EngineMode, PhysicsStatusCode } from "../../src/proto/index.js";

describe("MCP Physics Pipeline (End-to-End Integration)", () => {
  let bridgeService: PhysicsBridgeService;
  let mcpClient: Client;

  const testConfig: BridgeConfig = {
    ...defaultConfig,
    grpcPort: 50063,
    grpcWebPort: 50064,
    wsPort: 8091,
    sqliteVectorPath: ":memory:",
    byokLlmProvider: "mock",
  };

  beforeAll(async () => {
    bridgeService = new PhysicsBridgeService(testConfig);
    // Initialize vector store
    await bridgeService.vectorStore.initialize();

    // Connect MCP client to bridge service MCP server
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await bridgeService.mcpServer.connect(serverTransport);

    mcpClient = new Client({
      name: "e2e-physics-agent",
      version: "1.0.0",
    });

    await mcpClient.connect(clientTransport);
  });

  afterAll(async () => {
    await mcpClient.close();
    await bridgeService.mcpServer.stop();
    await bridgeService.vectorStore.close();
  });

  it("Step 1: Agent inspects server capabilities and reads game heuristics resource", async () => {
    const resources = await mcpClient.listResources();
    expect(resources.resources.length).toBeGreaterThan(0);

    const heuristicsRes = await mcpClient.readResource({ uri: "physics://heuristics" });
    expect(heuristicsRes.contents[0].text).toContain("Physics Engine Reasoning Kernel");
    expect(heuristicsRes.contents[0].text).toContain("Dual-Payload Delivery");

    const statusRes = await mcpClient.readResource({ uri: "physics://server/status" });
    const statusJson = JSON.parse(statusRes.contents[0].text as string);
    expect(statusJson.status).toBe("OPERATIONAL");
    expect(statusJson.vectorStore.ready).toBe(true);
  });

  it("Step 2: Agent reads bundled AssemblyScript math library documentation", async () => {
    const vec3Res = await mcpClient.readResource({ uri: "physics://math/vector3" });
    expect(vec3Res.contents[0].text).toContain("AssemblyScript Vector3 API");
    expect(vec3Res.contents[0].text).toContain("distanceTo");

    const quatRes = await mcpClient.readResource({ uri: "physics://math/quaternion" });
    expect(quatRes.contents[0].text).toContain("AssemblyScript Quaternion API");
    expect(quatRes.contents[0].text).toContain("fromAxisAngle");
  });

  it("Step 3: Agent generates AssemblyScript physics kernel via BYOK tool and verifies Dual-Payload", async () => {
    const genResult = await mcpClient.callTool({
      name: "generate_physics_kernel",
      arguments: {
        description: "Kinematic jump arc with gravity deceleration",
        moduleId: "e2e_jump_arc",
        entrypointFunction: "stepPhysics",
        testArgs: [0.016],
      },
    });

    const parsed = JSON.parse((genResult.content[0] as any).text);
    expect(parsed.success).toBe(true);
    expect(parsed.moduleId).toBe("e2e_jump_arc");
    expect(parsed.sourceChecksum).toHaveLength(64);
    expect(parsed.wasmByteLength).toBeGreaterThan(0);
    expect(parsed.compilation.success).toBe(true);
    expect(parsed.executionResult.success).toBe(true);

    // Deploy and verify Dual-Payload module
    const deployResult = await mcpClient.callTool({
      name: "deploy_dual_payload_logic",
      arguments: {
        moduleId: parsed.moduleId,
        assemblyscriptSource: parsed.assemblyscriptSource,
        sourceChecksum: parsed.sourceChecksum,
      },
    });

    const deployParsed = JSON.parse((deployResult.content[0] as any).text);
    expect(deployParsed.success).toBe(true);
    expect(deployParsed.matchesProvidedChecksum).toBe(true);
    expect(deployParsed.wasmHeaderValid).toBe(true);
  });

  it("Step 4: Agent validates frame in Playtest Mode (soft clamping excessive kinematics)", async () => {
    const validateResult = await mcpClient.callTool({
      name: "validate_physics_frame",
      arguments: {
        frameId: "1001",
        mode: "PLAYTEST",
        entityCount: 2,
        positions: [
          { x: 0.0, y: 1.0, z: 0.0 },
          { x: 0.0, y: 1.2, z: 0.0 }, // Penetrating collision
        ],
        velocities: [
          { x: 250.0, y: 0.0, z: 0.0 }, // Exceeds default max linear vel (100 m/s)
          { x: 0.0, y: 0.0, z: 0.0 },
        ],
      },
    });

    const parsed = JSON.parse((validateResult.content[0] as any).text);
    expect(parsed.frameId).toBe("1001");
    expect(parsed.mode).toBe("PLAYTEST");
    expect(["STATUS_SOFT_CLAMPED", "STATUS_TIME_DILATED"]).toContain(parsed.statusName);
    expect(parsed.correctedEntities).toBeDefined();
    // Clamped linear velocity
    expect(parsed.correctedEntities[0].vel[0]).toBeLessThanOrEqual(100.0);
  });

  it("Step 5: Agent validates frame in Debug Mode (strict hard rejection on NaN)", async () => {
    const validateResult = await mcpClient.callTool({
      name: "validate_physics_frame",
      arguments: {
        frameId: "1002",
        mode: "DEBUG",
        entityCount: 1,
        positions: [{ x: "NaN", y: 0.0, z: 0.0 }],
      },
    });

    const parsed = JSON.parse((validateResult.content[0] as any).text);
    expect(parsed.frameId).toBe("1002");
    expect(parsed.mode).toBe("DEBUG");
    expect(parsed.statusName).toBe("STATUS_NAN_DETECTED");
    expect(parsed.errors).toContain("NAN_OR_INF");
  });

  it("Step 6: Agent indexes keyframe events and queries history via SQLite-Vector RAG tool", async () => {
    // Index collision keyframe
    await bridgeService.keyframeIndexer.indexKeyframeEvent("collision", {
      frameId: 500n,
      timestampNs: 500_000_000n,
      entities: [
        {
          id: 1,
          name: "Hero",
          position: { x: 12.0, y: 0.0, z: 5.0 },
          velocity: { x: 8.5, y: 0.0, z: 0.0 },
          rotation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 },
        },
      ],
    });

    const ragResult = await mcpClient.callTool({
      name: "query_keyframe_history",
      arguments: {
        query: "hero collision near x 12",
        limit: 2,
      },
    });

    const parsed = JSON.parse((ragResult.content[0] as any).text);
    expect(parsed.resultCount).toBeGreaterThan(0);
    expect(parsed.promptContextMarkdown).toContain("Relevant Keyframe History");
    expect(parsed.records[0].eventName).toBe("collision");
  });

  it("Step 7: Agent synthesizes character animation intents and procedural root motion", async () => {
    const animResult = await mcpClient.callTool({
      name: "synthesize_animation",
      arguments: {
        entityId: 42,
        intentName: "Sprint",
        genre: "GENRE_FPS",
        desiredVelocity: 7.0,
        actualVelocity: 5.6,
      },
    });

    const parsed = JSON.parse((animResult.content[0] as any).text);
    expect(parsed.entityId).toBe(42);
    expect(parsed.activeIntent).toBe("Sprint");
    expect(parsed.playbackScale).toBeCloseTo(5.6 / 7.0, 1);
    expect(parsed.blendWeights.length).toBeGreaterThan(0);
  });

  it("Step 8: Agent records reflective failure and repairs module via MCP self-repair tool", async () => {
    // Store failure in vector store
    const embedder = bridgeService.keyframeIndexer.getEmbedder();
    const diagEmbedding = embedder.embedText("Unbounded velocity divergence snap");

    await bridgeService.vectorStore.insertFailureRecord({
      failureId: "fail_e2e_01",
      moduleId: "divergent_projectile",
      failedFrameId: 888n,
      errorLog: "ERROR_DIVERGENCE_SNAP: Entity exceeded maximum displacement delta",
      astDiff: "- pos = pos + vel;\n+ pos = pos + vel * safeDt;",
      embedding: diagEmbedding,
      timestamp: Date.now(),
    });

    // Inspect failure via MCP tool
    const inspectResult = await mcpClient.callTool({
      name: "inspect_reflective_memory",
      arguments: {
        query: "divergence snap",
        moduleId: "divergent_projectile",
      },
    });

    const inspectParsed = JSON.parse((inspectResult.content[0] as any).text);
    expect(inspectParsed.resultCount).toBe(1);
    expect(inspectParsed.failures[0].failureId).toBe("fail_e2e_01");

    // Repair module using repair_physics_kernel
    const repairResult = await mcpClient.callTool({
      name: "repair_physics_kernel",
      arguments: {
        moduleId: "divergent_projectile",
        originalSource: `
export function stepPhysics(dt: f32): f32 {
  return 1000000.0;
}
`,
        errorLog: inspectParsed.failures[0].errorLog,
        astDiff: inspectParsed.failures[0].astDiff,
        failedFrameId: "888",
      },
    });

    const repairParsed = JSON.parse((repairResult.content[0] as any).text);
    expect(repairParsed.success).toBe(true);
    expect(repairParsed.moduleId).toBe("divergent_projectile");
    expect(repairParsed.compilation.success).toBe(true);
    expect(repairParsed.executionResult.success).toBe(true);
  });
});
