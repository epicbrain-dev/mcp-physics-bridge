import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MCPPhysicsBridgeServer } from "../../src/mcp/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { defaultConfig, BridgeConfig } from "../../src/config.js";
import { SQLiteVectorStore, KeyframeIndexer } from "../../src/memory/index.js";
import { StateAuthorityManager } from "../../src/validation/authority_manager.js";
import { GenreTemplate } from "../../src/proto/index.js";

describe("MCPPhysicsBridgeServer (Model Context Protocol SDK Integration)", () => {
  let bridgeServer: MCPPhysicsBridgeServer;
  let vectorStore: SQLiteVectorStore;
  let keyframeIndexer: KeyframeIndexer;
  let authorityManager: StateAuthorityManager;
  let mcpClient: Client;

  const testConfig: BridgeConfig = {
    ...defaultConfig,
    sqliteVectorPath: ":memory:",
    byokLlmProvider: "mock",
    wasmExecutionTimeoutMs: 500,
  };

  beforeAll(async () => {
    vectorStore = new SQLiteVectorStore(testConfig, { inMemory: true });
    await vectorStore.initialize();
    keyframeIndexer = new KeyframeIndexer(vectorStore);
    authorityManager = new StateAuthorityManager();

    bridgeServer = new MCPPhysicsBridgeServer(testConfig, {
      vectorStore,
      keyframeIndexer,
      authorityManager,
    });

    // Create linked in-memory transports
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await bridgeServer.connect(serverTransport);

    mcpClient = new Client({
      name: "test-mcp-physics-client",
      version: "1.0.0",
    });

    await mcpClient.connect(clientTransport);
  });

  afterAll(async () => {
    await mcpClient.close();
    await bridgeServer.stop();
    await vectorStore.close();
  });

  describe("Server Status & Available Tools", () => {
    it("reports operational status with mock BYOK provider", () => {
      const status = bridgeServer.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.isConnected).toBe(true);
      expect(status.byokProvider).toBe("mock");
    });

    it("lists all registered physics, inspection, animation, and BYOK LLM tools via MCP Client", async () => {
      const { tools } = await mcpClient.listTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain("compile_and_test_physics");
      expect(toolNames).toContain("validate_physics_frame");
      expect(toolNames).toContain("deploy_dual_payload_logic");
      expect(toolNames).toContain("inspect_game_state");
      expect(toolNames).toContain("query_keyframe_history");
      expect(toolNames).toContain("inspect_reflective_memory");
      expect(toolNames).toContain("synthesize_animation");
      expect(toolNames).toContain("generate_physics_kernel");
      expect(toolNames).toContain("repair_physics_kernel");
    });
  });

  describe("Tool Execution via MCP Protocol", () => {
    it("executes compile_and_test_physics and runs in Wasm sandbox", async () => {
      const validSource = `
import { Vector3 } from "./math/vector3";

export function stepPhysics(dt: f32): f32 {
  let v = new Vector3(1.0, 2.0, 3.0);
  return v.length();
}
`;
      const result = await mcpClient.callTool({
        name: "compile_and_test_physics",
        arguments: {
          moduleId: "mcp_vec_test",
          assemblyscriptSource: validSource,
          entrypointFunction: "stepPhysics",
          testArgs: [0.016],
        },
      });

      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.moduleId).toBe("mcp_vec_test");
      expect(parsed.wasmByteLength).toBeGreaterThan(0);
      expect(parsed.sourceChecksum).toHaveLength(64);
      expect(parsed.execution.success).toBe(true);
      // sqrt(1^2 + 2^2 + 3^2) = sqrt(14) ≈ 3.7416
      expect(parsed.execution.returnValue).toBeCloseTo(3.7416, 2);
    });

    it("executes validate_physics_frame in PLAYTEST mode with soft clamping", async () => {
      const result = await mcpClient.callTool({
        name: "validate_physics_frame",
        arguments: {
          frameId: "100",
          mode: "PLAYTEST",
          entityCount: 1,
          velocities: [{ x: 500.0, y: 0.0, z: 0.0 }], // Excessive velocity > maxLinearVelocity
        },
      });

      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.frameId).toBe("100");
      expect(parsed.mode).toBe("PLAYTEST");
      // In playtest mode, excessive velocity triggers soft clamping
      expect(parsed.statusName).toBe("STATUS_SOFT_CLAMPED");
      expect(parsed.correctedEntities).toBeDefined();
      expect(parsed.correctedEntities[0].vel[0]).toBeLessThan(500.0);
    });

    it("executes validate_physics_frame in DEBUG mode with strict hard rejection", async () => {
      const result = await mcpClient.callTool({
        name: "validate_physics_frame",
        arguments: {
          frameId: "101",
          mode: "DEBUG",
          entityCount: 1,
          velocities: [{ x: 500.0, y: 0.0, z: 0.0 }],
        },
      });

      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.frameId).toBe("101");
      expect(parsed.mode).toBe("DEBUG");
      expect(parsed.statusName).toBe("STATUS_HARD_REJECTED");
      expect(parsed.frameErrorBitmask).toBeGreaterThan(0);
      expect(parsed.errors).toContain("LINEAR_VEL_EXCEEDED");
    });

    it("executes inspect_game_state returning hierarchical scene tree", async () => {
      const result = await mcpClient.callTool({
        name: "inspect_game_state",
        arguments: {},
      });

      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.frameId).toBe("1");
      expect(parsed.totalEntities).toBeGreaterThanOrEqual(1);
      expect(parsed.sceneTree).toBeDefined();
    });

    it("executes query_keyframe_history and retrieves RAG context", async () => {
      // Index a test keyframe first
      await keyframeIndexer.indexKeyframeEvent("collision", {
        frameId: 50n,
        timestampNs: 50_000_000n,
        entities: [
          {
            id: 1,
            position: { x: 5.0, y: 0.0, z: 0.0 },
            velocity: { x: 10.0, y: 0.0, z: 0.0 },
            rotation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 },
          },
        ],
      });

      const result = await mcpClient.callTool({
        name: "query_keyframe_history",
        arguments: {
          query: "high speed collision at frame 50",
          limit: 3,
        },
      });

      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.query).toBe("high speed collision at frame 50");
      expect(parsed.resultCount).toBeGreaterThan(0);
      expect(parsed.promptContextMarkdown).toContain("Relevant Keyframe History");
      expect(parsed.records[0].eventName).toBe("collision");
    });

    it("executes synthesize_animation with intent mapping and root motion scaling", async () => {
      const result = await mcpClient.callTool({
        name: "synthesize_animation",
        arguments: {
          entityId: 1,
          intentName: "Run",
          genre: "GENRE_PLATFORMER",
          desiredVelocity: 5.0,
          actualVelocity: 4.0,
        },
      });

      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.entityId).toBe(1);
      expect(parsed.activeIntent).toBe("Run");
      expect(parsed.blendWeights.length).toBeGreaterThan(0);
      expect(parsed.playbackScale).toBeCloseTo(4.0 / 8.0, 1);
    });

    it("executes generate_physics_kernel via BYOK routing", async () => {
      const result = await mcpClient.callTool({
        name: "generate_physics_kernel",
        arguments: {
          description: "Generate deterministic gravity integrator",
          moduleId: "mcp_gen_kernel",
        },
      });

      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.moduleId).toBe("mcp_gen_kernel");
      expect(parsed.compilation.success).toBe(true);
      expect(parsed.executionResult?.success).toBe(true);
    });

    it("executes repair_physics_kernel via reflective memory", async () => {
      const failingSource = `
export function stepPhysics(dt: f32): f32 {
  return 1.0 / 0.0;
}
`;
      const result = await mcpClient.callTool({
        name: "repair_physics_kernel",
        arguments: {
          moduleId: "mcp_repair_kernel",
          originalSource: failingSource,
          errorLog: "ERROR_NAN_OR_INF: Infinite value detected",
        },
      });

      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.moduleId).toBe("mcp_repair_kernel");
      expect(parsed.compilation.success).toBe(true);
      expect(parsed.executionResult?.success).toBe(true);
    });
  });

  describe("Resource Registration & Retrieval via MCP Protocol", () => {
    it("lists registered physics resources", async () => {
      const { resources } = await mcpClient.listResources();
      const uris = resources.map((r) => r.uri);

      expect(uris).toContain("physics://config");
      expect(uris).toContain("physics://server/status");
      expect(uris).toContain("physics://heuristics");
      expect(uris).toContain("physics://math/vector3");
      expect(uris).toContain("physics://math/quaternion");
      expect(uris).toContain("physics://animation/templates");
      expect(uris).toContain("physics://memory/failures");
    });

    it("reads physics://config resource", async () => {
      const result = await mcpClient.readResource({ uri: "physics://config" });
      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse((result.contents[0] as any).text);
      expect(parsed.targetFps).toBe(60);
      expect(parsed.byokLlmProvider).toBe("mock");
    });

    it("reads physics://heuristics resource", async () => {
      const result = await mcpClient.readResource({ uri: "physics://heuristics" });
      expect(result.contents[0].text).toContain("Physics Engine Reasoning Kernel");
      expect(result.contents[0].text).toContain("AssemblyScript math library");
    });

    it("reads physics://math/vector3 resource", async () => {
      const result = await mcpClient.readResource({ uri: "physics://math/vector3" });
      expect(result.contents[0].text).toContain("AssemblyScript Vector3 API Documentation");
      expect(result.contents[0].text).toContain("lengthSquared");
    });

    it("reads physics://animation/templates resource", async () => {
      const result = await mcpClient.readResource({ uri: "physics://animation/templates" });
      const parsed = JSON.parse((result.contents[0] as any).text);
      expect(parsed.genres).toHaveLength(5);
      expect(parsed.genres.map((g: any) => g.name)).toContain("GENRE_FPS");
      expect(parsed.layers).toHaveLength(4);
    });
  });

  describe("Prompt Registration & Retrieval via MCP Protocol", () => {
    it("lists registered prompts", async () => {
      const { prompts } = await mcpClient.listPrompts();
      const promptNames = prompts.map((p) => p.name);

      expect(promptNames).toContain("game_heuristics_kernel");
      expect(promptNames).toContain("debug_physics_failure");
      expect(promptNames).toContain("synthesize_character_animation");
    });

    it("retrieves game_heuristics_kernel prompt with parameters", async () => {
      const prompt = await mcpClient.getPrompt({
        name: "game_heuristics_kernel",
        arguments: {
          taskDescription: "Implement double jump mechanic",
          targetEntity: "PlayerCharacter",
        },
      });

      expect(prompt.messages).toHaveLength(1);
      const text = (prompt.messages[0].content as any).text;
      expect(text).toContain("Implement double jump mechanic");
      expect(text).toContain("PlayerCharacter");
      expect(text).toContain("Vector3");
    });

    it("retrieves debug_physics_failure prompt with parameters", async () => {
      const prompt = await mcpClient.getPrompt({
        name: "debug_physics_failure",
        arguments: {
          moduleId: "player_controller_v1",
          errorLog: "ERROR_ROTATION_UNNORMALIZED: Quaternion w=2.5",
        },
      });

      expect(prompt.messages).toHaveLength(1);
      const text = (prompt.messages[0].content as any).text;
      expect(text).toContain("player_controller_v1");
      expect(text).toContain("ERROR_ROTATION_UNNORMALIZED");
    });

    it("retrieves synthesize_character_animation prompt with parameters", async () => {
      const prompt = await mcpClient.getPrompt({
        name: "synthesize_character_animation",
        arguments: {
          characterAction: "Player is rolling away from enemy attack",
          genre: "GENRE_ACTION_RPG",
          currentSpeed: "3.5",
        },
      });

      expect(prompt.messages).toHaveLength(1);
      const text = (prompt.messages[0].content as any).text;
      expect(text).toContain("Player is rolling away from enemy attack");
      expect(text).toContain("GENRE_ACTION_RPG");
      expect(text).toContain("3.5 m/s");
    });
  });
});
