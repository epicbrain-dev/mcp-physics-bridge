import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MCPPhysicsBridgeServer } from "../../src/mcp/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { defaultConfig, BridgeConfig } from "../../src/config.js";
import { SQLiteVectorStore, KeyframeIndexer } from "../../src/memory/index.js";
import { StateAuthorityManager } from "../../src/validation/authority_manager.js";

describe("Inspection Tools Extended Verification", () => {
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
      name: "test-inspection-extended-client",
      version: "1.0.0",
    });

    await mcpClient.connect(clientTransport);
  });

  afterAll(async () => {
    await mcpClient.close();
    await bridgeServer.stop();
    await vectorStore.close();
  });

  describe("inspect_game_state Edge Cases & Hierarchy Lookups", () => {
    it("handles invalid frameJson syntax gracefully", async () => {
      const res = await mcpClient.callTool({
        name: "inspect_game_state",
        arguments: {
          frameJson: "{ malformed json: true, ",
        },
      });

      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed.error).toContain("Invalid frameJson provided");
    });

    it("finds a child entity deeply nested in the default scene hierarchy", async () => {
      const res = await mcpClient.callTool({
        name: "inspect_game_state",
        arguments: {
          targetEntityId: 2, // UpperTorso is child of PlayerRoot
        },
      });

      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed.entity).toBeDefined();
      expect(parsed.entity.id).toBe(2);
      expect(parsed.entity.name).toBe("UpperTorso");
      expect(parsed.entity.mass).toBe(25.0);
    });

    it("returns error response when targetEntityId does not exist in hierarchy", async () => {
      const res = await mcpClient.callTool({
        name: "inspect_game_state",
        arguments: {
          targetEntityId: 9999,
        },
      });

      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed.error).toContain("Entity with ID 9999 not found in scene tree");
    });

    it("inspects custom hierarchical scene tree provided in frameJson", async () => {
      const customTree = {
        frameId: "55",
        timestampNs: "1000000",
        entities: [
          {
            id: 10,
            name: "VehicleBase",
            position: { x: 5, y: 0, z: 5 },
            velocity: { x: 10, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            children: [
              {
                id: 11,
                name: "Turret",
                position: { x: 5, y: 1.5, z: 5 },
                velocity: { x: 10, y: 0, z: 0 },
                rotation: { x: 0, y: 0.707, z: 0, w: 0.707 },
              },
            ],
          },
        ],
      };

      const res = await mcpClient.callTool({
        name: "inspect_game_state",
        arguments: {
          frameJson: JSON.stringify(customTree),
          targetEntityId: 11,
        },
      });

      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed.entity).toBeDefined();
      expect(parsed.entity.id).toBe(11);
      expect(parsed.entity.name).toBe("Turret");
    });
  });

  describe("inspect_reflective_memory Edge Cases & Fallback", () => {
    it("searches reflective memory without a query argument (uses default fallback)", async () => {
      // Seed a failure
      const embedder = keyframeIndexer.getEmbedder();
      const embedding = embedder.embedText("physics error failure diverged");

      await vectorStore.insertFailureRecord({
        failureId: "refl_fallback_01",
        moduleId: "navmesh_agent",
        failedFrameId: 300n,
        errorLog: "NAN_DETECTED: Position nan in navmesh steering",
        astDiff: "- steer();\n+ safeSteer();",
        embedding,
        timestamp: Date.now(),
      });

      const res = await mcpClient.callTool({
        name: "inspect_reflective_memory",
        arguments: {
          // No query specified!
          moduleId: "navmesh_agent",
        },
      });

      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed.query).toBe("all");
      expect(parsed.resultCount).toBeGreaterThanOrEqual(1);
      expect(parsed.failures[0].moduleId).toBe("navmesh_agent");
    });

    it("filters search results by specific moduleId correctly", async () => {
      const res = await mcpClient.callTool({
        name: "inspect_reflective_memory",
        arguments: {
          query: "steering",
          moduleId: "non_existent_module",
        },
      });

      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed.resultCount).toBe(0);
      expect(parsed.failures).toHaveLength(0);
    });
  });
});
