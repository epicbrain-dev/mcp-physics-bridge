import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MCPPhysicsBridgeServer } from "../../src/mcp/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { defaultConfig, BridgeConfig } from "../../src/config.js";
import { SQLiteVectorStore, KeyframeIndexer } from "../../src/memory/index.js";
import { StateAuthorityManager } from "../../src/validation/authority_manager.js";
import { ByokLlmRouter, MATH_API_REFERENCE } from "../../src/mcp/llm/index.js";

describe("MCP Resources & Prompts Integration", () => {
  let bridgeServer: MCPPhysicsBridgeServer;
  let vectorStore: SQLiteVectorStore;
  let keyframeIndexer: KeyframeIndexer;
  let authorityManager: StateAuthorityManager;
  let mcpClient: Client;

  const testConfig: BridgeConfig = {
    ...defaultConfig,
    sqliteVectorPath: ":memory:",
    byokLlmProvider: "mock",
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

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await bridgeServer.connect(serverTransport);

    mcpClient = new Client({
      name: "test-mcp-prompts-client",
      version: "1.0.0",
    });

    await mcpClient.connect(clientTransport);
  });

  afterAll(async () => {
    await mcpClient.close();
    await bridgeServer.stop();
    await vectorStore.close();
  });

  describe("Re-exports in mcp/llm/index.ts", () => {
    it("correctly exports ByokLlmRouter and MATH_API_REFERENCE", () => {
      expect(ByokLlmRouter).toBeDefined();
      expect(typeof ByokLlmRouter).toBe("function");
      expect(MATH_API_REFERENCE).toBeDefined();
      expect(typeof MATH_API_REFERENCE).toBe("string");
      expect(MATH_API_REFERENCE).toContain("class Vector3");
      expect(MATH_API_REFERENCE).toContain("class Quaternion");
    });
  });

  describe("physics://memory/failures Resource Endpoint", () => {
    it("returns empty failure list when no failures have been indexed", async () => {
      const res = await mcpClient.readResource({ uri: "physics://memory/failures" });
      expect(res.contents).toHaveLength(1);
      const parsed = JSON.parse(res.contents[0].text as string);
      expect(parsed.totalFailuresStored).toBe(0);
      expect(parsed.recentFailures).toEqual([]);
    });

    it("returns populated failure history when failures exist in SQLiteVectorStore", async () => {
      const embedder = keyframeIndexer.getEmbedder();
      const embedding = embedder.embedText("Collision penetration error");

      await vectorStore.insertFailureRecord({
        failureId: "res_fail_01",
        moduleId: "collision_resolver",
        failedFrameId: 1042n,
        errorLog: "ERR_COLLISION: Unresolved penetration depth 0.45",
        astDiff: "- resolveContact();\n+ resolveContactImpulse();",
        embedding,
        timestamp: 1700000000000,
      });

      const res = await mcpClient.readResource({ uri: "physics://memory/failures" });
      const parsed = JSON.parse(res.contents[0].text as string);
      expect(parsed.totalFailuresStored).toBeGreaterThanOrEqual(1);
      const target = parsed.recentFailures.find((f: any) => f.failureId === "res_fail_01");
      expect(target).toBeDefined();
      expect(target.moduleId).toBe("collision_resolver");
      expect(target.failedFrameId).toBe("1042");
      expect(target.errorLog).toContain("ERR_COLLISION");
      expect(target.hasAstDiff).toBe(true);
      expect(target.timestamp).toBe(1700000000000);
    });
  });

  describe("MCP Prompts Retrieval and Formatting", () => {
    it("lists all registered prompts", async () => {
      const { prompts } = await mcpClient.listPrompts();
      const promptNames = prompts.map((p) => p.name);
      expect(promptNames).toContain("game_heuristics_kernel");
      expect(promptNames).toContain("debug_physics_failure");
      expect(promptNames).toContain("synthesize_character_animation");
    });

    it("retrieves game_heuristics_kernel prompt with default and custom arguments", async () => {
      const pDefault = await mcpClient.getPrompt({
        name: "game_heuristics_kernel",
        arguments: {
          taskDescription: "Implement double jump arc",
        },
      });
      expect(pDefault.messages).toHaveLength(1);
      const textDefault = (pDefault.messages[0].content as any).text;
      expect(textDefault).toContain("You are the Physics Engine Reasoning Kernel");
      expect(textDefault).toContain('Task: Implement game physics logic for "Implement double jump arc"');
      expect(textDefault).toContain("Target Entity: Primary Character");

      const pCustom = await mcpClient.getPrompt({
        name: "game_heuristics_kernel",
        arguments: {
          taskDescription: "Vehicle suspension dampers",
          targetEntity: "Car_Chassis",
          contextJson: JSON.stringify({ springRate: 1500, damping: 0.8 }),
        },
      });
      const textCustom = (pCustom.messages[0].content as any).text;
      expect(textCustom).toContain('Task: Implement game physics logic for "Vehicle suspension dampers"');
      expect(textCustom).toContain("Target Entity: Car_Chassis");
      expect(textCustom).toContain("Scene State:");
      expect(textCustom).toContain("springRate");
    });

    it("retrieves debug_physics_failure prompt with minimal arguments", async () => {
      const p = await mcpClient.getPrompt({
        name: "debug_physics_failure",
        arguments: {
          moduleId: "character_controller",
          errorLog: "DIVIDE_BY_ZERO: Velocity calculation divided by zero delta time",
        },
      });

      const text = (p.messages[0].content as any).text;
      expect(text).toContain("character_controller");
      expect(text).toContain("DIVIDE_BY_ZERO");
      expect(text).not.toContain("Original Source:");
      expect(text).not.toContain("AST Structural Diff:");
    });

    it("retrieves debug_physics_failure prompt with originalSource and astDiff included", async () => {
      const p = await mcpClient.getPrompt({
        name: "debug_physics_failure",
        arguments: {
          moduleId: "character_controller",
          errorLog: "NAN_DETECTED: Position vector contained NaN",
          originalSource: "export function step(dt: f32): f32 { return 1.0 / dt; }",
          astDiff: "- let vel = dist / dt;\n+ let vel = dt > 0.0 ? dist / dt : 0.0;",
        },
      });

      const text = (p.messages[0].content as any).text;
      expect(text).toContain("character_controller");
      expect(text).toContain("Original Source:");
      expect(text).toContain("export function step(dt: f32)");
      expect(text).toContain("AST Structural Diff:");
      expect(text).toContain("- let vel = dist / dt;");
    });

    it("retrieves synthesize_character_animation prompt with minimal and full options", async () => {
      const pMin = await mcpClient.getPrompt({
        name: "synthesize_character_animation",
        arguments: {
          characterAction: "dodge_roll",
        },
      });
      const textMin = (pMin.messages[0].content as any).text;
      expect(textMin).toContain("Character Action: dodge_roll");
      expect(textMin).toContain("Genre: GENRE_GENERIC");
      expect(textMin).toContain("Current Speed: 0.0 m/s");

      const pFull = await mcpClient.getPrompt({
        name: "synthesize_character_animation",
        arguments: {
          characterAction: "tactical_slide",
          genre: "GENRE_FPS",
          currentSpeed: "8.5",
        },
      });
      const textFull = (pFull.messages[0].content as any).text;
      expect(textFull).toContain("Character Action: tactical_slide");
      expect(textFull).toContain("Genre: GENRE_FPS");
      expect(textFull).toContain("Current Speed: 8.5 m/s");
    });
  });
});
