import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SQLiteVectorStore } from "../../memory/vector_store.js";
import { KeyframeIndexer } from "../../memory/keyframe_indexer.js";
import { DataTranslationLayer } from "../../ecs/data_translator.js";
import { HierarchicalSceneTree, EntityPhysicsNode } from "../../ecs/soa_types.js";

export interface InspectionToolsDependencies {
  vectorStore: SQLiteVectorStore;
  keyframeIndexer: KeyframeIndexer;
  dataTranslator?: DataTranslationLayer;
}

export const InspectGameStateSchema = {
  targetEntityId: z
    .number()
    .optional()
    .describe("Optional entity ID to filter inspection to a single node"),
  frameJson: z
    .string()
    .optional()
    .describe("Optional serialized hierarchical scene tree or SoA frame to inspect"),
};

export const QueryKeyframeHistorySchema = {
  query: z.string().describe("Natural language query or kinematic search description"),
  limit: z
    .number()
    .optional()
    .default(5)
    .describe("Maximum number of keyframe records to retrieve"),
  minSimilarity: z
    .number()
    .optional()
    .default(0.0)
    .describe("Minimum cosine similarity threshold (0.0 to 1.0)"),
  eventNameFilter: z
    .string()
    .optional()
    .describe("Optional keyframe event filter (e.g. collision, goal, state_change)"),
};

export const InspectReflectiveMemorySchema = {
  query: z
    .string()
    .optional()
    .describe("Optional text search query to find similar past failure logs"),
  moduleId: z
    .string()
    .optional()
    .describe("Optional module ID filter"),
  limit: z
    .number()
    .optional()
    .default(5)
    .describe("Maximum number of failure records to return"),
};

/**
 * Registers inspection and memory RAG tools with the MCP server.
 */
export function registerInspectionTools(
  server: McpServer,
  deps: InspectionToolsDependencies
): void {
  const translator = deps.dataTranslator ?? new DataTranslationLayer();

  // 1. inspect_game_state
  server.tool(
    "inspect_game_state",
    "Inspects current active entity physics state translated into hierarchical scene tree format.",
    InspectGameStateSchema,
    async ({ targetEntityId, frameJson }) => {
      let tree: HierarchicalSceneTree;

      if (frameJson) {
        try {
          const parsed = JSON.parse(frameJson);
          if (parsed.entities && Array.isArray(parsed.entities)) {
            tree = parsed as HierarchicalSceneTree;
          } else {
            tree = translator.soaToHierarchy(parsed);
          }
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: "Invalid frameJson provided: could not parse as JSON" },
                  null,
                  2
                ),
              },
            ],
          };
        }
      } else {
        // Generate a default inspection state tree
        tree = {
          frameId: 1n,
          timestampNs: BigInt(Date.now()) * 1_000_000n,
          entities: [
            {
              id: 1,
              name: "PlayerRoot",
              position: { x: 0.0, y: 1.0, z: 0.0 },
              velocity: { x: 0.0, y: 0.0, z: 0.0 },
              rotation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 },
              angularVelocity: { x: 0.0, y: 0.0, z: 0.0 },
              radius: 0.5,
              mass: 75.0,
              children: [
                {
                  id: 2,
                  name: "UpperTorso",
                  position: { x: 0.0, y: 0.6, z: 0.0 },
                  velocity: { x: 0.0, y: 0.0, z: 0.0 },
                  rotation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 },
                  angularVelocity: { x: 0.0, y: 0.0, z: 0.0 },
                  radius: 0.3,
                  mass: 25.0,
                },
              ],
            },
          ],
        };
      }

      // If targetEntityId is requested, find that node
      if (targetEntityId !== undefined) {
        const found = findEntityNode(tree.entities, targetEntityId);
        if (!found) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    frameId: tree.frameId.toString(),
                    error: `Entity with ID ${targetEntityId} not found in scene tree`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  frameId: tree.frameId.toString(),
                  targetEntityId,
                  entity: found,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Return compact JSON representation of entire scene tree
      const compact = translator.toCompactJson(tree, {
        precision: 3,
        includeVelocities: true,
        includeRotations: true,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                frameId: tree.frameId.toString(),
                totalEntities: countEntities(tree.entities),
                sceneTree: JSON.parse(compact),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // 2. query_keyframe_history
  server.tool(
    "query_keyframe_history",
    "Retrieves past keyframe snapshots and reflective failure logs using SQLite-Vector RAG.",
    QueryKeyframeHistorySchema,
    async ({ query, limit, minSimilarity, eventNameFilter }) => {
      const results = await deps.keyframeIndexer.queryContextByText(
        query,
        limit ?? 5,
        minSimilarity ?? 0.0,
        eventNameFilter
      );

      const formattedRag = deps.keyframeIndexer.formatRAGPromptContext(results);

      const response = {
        query,
        resultCount: results.length,
        promptContextMarkdown: formattedRag,
        records: results.map((r) => ({
          keyframeId: r.keyframeId,
          frameId: r.frameId.toString(),
          eventName: r.eventName,
          similarity: Number(r.similarity.toFixed(4)),
          stateJson: r.stateJson,
          timestamp: r.timestamp,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  // 3. inspect_reflective_memory
  server.tool(
    "inspect_reflective_memory",
    "Retrieves past reflective failure reports, AST diffs, and compressed error logs from SQLite-Vector storage.",
    InspectReflectiveMemorySchema,
    async ({ query, moduleId, limit }) => {
      let results: any[] = [];

      if (query) {
        const embedder = deps.keyframeIndexer.getEmbedder();
        const queryEmbedding = embedder.embedText(query);
        results = await deps.vectorStore.searchSimilarFailures(
          queryEmbedding,
          limit ?? 5,
          -1.0
        );
      } else {
        // Fallback: search with default neutral embedding
        const embedder = deps.keyframeIndexer.getEmbedder();
        const queryEmbedding = embedder.embedText("physics error failure");
        results = await deps.vectorStore.searchSimilarFailures(
          queryEmbedding,
          limit ?? 5,
          -1.0
        );
      }

      if (moduleId) {
        results = results.filter((r) => r.moduleId === moduleId);
      }

      const response = {
        query: query ?? "all",
        resultCount: results.length,
        failures: results.map((r) => ({
          failureId: r.failureId,
          moduleId: r.moduleId,
          failedFrameId: r.failedFrameId.toString(),
          errorLog: r.errorLog,
          astDiff: r.astDiff,
          similarity: Number(r.similarity?.toFixed(4) ?? "1.0"),
          timestamp: r.timestamp,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}

function findEntityNode(nodes: EntityPhysicsNode[], id: number): EntityPhysicsNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findEntityNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function countEntities(nodes: EntityPhysicsNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (node.children) {
      count += countEntities(node.children);
    }
  }
  return count;
}

// Backward compatibility export
export const INSPECTION_TOOLS = [
  {
    name: "inspect_game_state",
    description: "Inspects current active entity physics state translated into hierarchical format.",
    inputSchema: {
      type: "object",
      properties: {
        targetEntityId: { type: "number" },
      },
    },
  },
  {
    name: "query_keyframe_history",
    description: "Retrieves past keyframe snapshots and reflective failure logs using SQLite-Vector RAG.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "inspect_reflective_memory",
    description: "Retrieves past reflective failure logs and AST diffs from SQLite-Vector failure storage.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        moduleId: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
];
