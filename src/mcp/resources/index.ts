import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BridgeConfig } from "../../config.js";
import { SQLiteVectorStore } from "../../memory/vector_store.js";
import { StateAuthorityManager } from "../../validation/authority_manager.js";
import { GAME_PHYSICS_SYSTEM_PROMPT } from "../prompts/game_heuristics.js";
import { StandardGenreTemplates } from "../../animation/intent_mapper.js";
import { GenreTemplate, AnimationLayer } from "../../proto/index.js";

export interface ResourcesDependencies {
  config: BridgeConfig;
  vectorStore?: SQLiteVectorStore;
  authorityManager?: StateAuthorityManager;
}

export const VECTOR3_DOCUMENTATION = `
AssemblyScript Vector3 API Documentation
Location: src/sandbox/assemblyscript/math/vector3.ts
Namespace / Import: import { Vector3 } from "./math/vector3";

Constructor:
  new Vector3(x: f32 = 0.0, y: f32 = 0.0, z: f32 = 0.0)

Methods:
  set(x: f32, y: f32, z: f32): Vector3
  add(v: Vector3): Vector3
  subtract(v: Vector3): Vector3
  scale(scalar: f32): Vector3
  multiply(v: Vector3): Vector3
  divide(scalar: f32): Vector3
  negate(): Vector3
  dot(v: Vector3): f32
  cross(v: Vector3): Vector3
  length(): f32
  lengthSquared(): f32
  normalize(): Vector3
  distanceTo(v: Vector3): f32
  distanceToSquared(v: Vector3): f32
  lerp(target: Vector3, t: f32): Vector3
  clone(): Vector3
  equals(v: Vector3, epsilon: f32 = 0.0001): bool
`.trim();

export const QUATERNION_DOCUMENTATION = `
AssemblyScript Quaternion API Documentation
Location: src/sandbox/assemblyscript/math/quaternion.ts
Namespace / Import: import { Quaternion } from "./math/quaternion";

Constructor:
  new Quaternion(x: f32 = 0.0, y: f32 = 0.0, z: f32 = 0.0, w: f32 = 1.0)

Methods:
  set(x: f32, y: f32, z: f32, w: f32): Quaternion
  identity(): Quaternion
  multiply(q: Quaternion): Quaternion
  rotateVector(v: Vector3): Vector3
  length(): f32
  lengthSquared(): f32
  normalize(): Quaternion
  conjugate(): Quaternion
  inverse(): Quaternion
  dot(q: Quaternion): f32
  slerp(target: Quaternion, t: f32): Quaternion
  clone(): Quaternion
  equals(q: Quaternion, epsilon: f32 = 0.0001): bool

Static Factory Methods:
  Quaternion.fromAxisAngle(axis: Vector3, angleRad: f32): Quaternion
  Quaternion.fromEuler(pitchRad: f32, yawRad: f32, rollRad: f32): Quaternion
`.trim();

/**
 * Registers standard MCP resources under physics:// URI scheme.
 */
export function registerResources(server: McpServer, deps: ResourcesDependencies): void {
  // 1. physics://config
  server.resource("config", "physics://config", async (uri) => {
    const safeConfig = {
      grpcPort: deps.config.grpcPort,
      grpcWebPort: deps.config.grpcWebPort,
      wsPort: deps.config.wsPort,
      targetFps: deps.config.targetFps,
      maxWasmMemoryPages: deps.config.maxWasmMemoryPages,
      wasmExecutionTimeoutMs: deps.config.wasmExecutionTimeoutMs,
      sqliteVectorPath: deps.config.sqliteVectorPath,
      byokLlmProvider: deps.config.byokLlmProvider,
      byokLlmModel: deps.config.byokLlmModel,
      byokLlmEndpoint: deps.config.byokLlmEndpoint ?? "default",
      hasApiKeyConfigured: Boolean(deps.config.byokLlmApiKey),
    };

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(safeConfig, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  });

  // 2. physics://server/status
  server.resource("server_status", "physics://server/status", async (uri) => {
    const keyframeCount = deps.vectorStore ? await deps.vectorStore.countKeyframes() : 0;
    const isVectorStoreReady = deps.vectorStore ? deps.vectorStore.isOpen() : false;

    const status = {
      serverName: "mcp-physics-bridge",
      version: "0.1.0",
      status: "OPERATIONAL",
      uptimeSeconds: process.uptime(),
      timestamp: new Date().toISOString(),
      targetFps: deps.config.targetFps,
      vectorStore: {
        ready: isVectorStoreReady,
        keyframeCount,
      },
    };

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(status, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  });

  // 3. physics://heuristics
  server.resource("heuristics", "physics://heuristics", async (uri) => {
    return {
      contents: [
        {
          uri: uri.href,
          text: GAME_PHYSICS_SYSTEM_PROMPT,
          mimeType: "text/plain",
        },
      ],
    };
  });

  // 4. physics://math/vector3
  server.resource("math_vector3", "physics://math/vector3", async (uri) => {
    return {
      contents: [
        {
          uri: uri.href,
          text: VECTOR3_DOCUMENTATION,
          mimeType: "text/plain",
        },
      ],
    };
  });

  // 5. physics://math/quaternion
  server.resource("math_quaternion", "physics://math/quaternion", async (uri) => {
    return {
      contents: [
        {
          uri: uri.href,
          text: QUATERNION_DOCUMENTATION,
          mimeType: "text/plain",
        },
      ],
    };
  });

  // 6. physics://animation/templates
  server.resource("animation_templates", "physics://animation/templates", async (uri) => {
    const templates = {
      genres: [
        {
          id: GenreTemplate.GENRE_GENERIC,
          name: "GENRE_GENERIC",
          description: "Universal character locomotion (Walk, Run, Jump, Idle)",
          supportedIntents: StandardGenreTemplates[GenreTemplate.GENRE_GENERIC].supportedIntents,
        },
        {
          id: GenreTemplate.GENRE_PLATFORMER,
          name: "GENRE_PLATFORMER",
          description: "Platforming mechanics (WallSlide, DoubleJump, Dash, Skid)",
          supportedIntents: StandardGenreTemplates[GenreTemplate.GENRE_PLATFORMER].supportedIntents,
        },
        {
          id: GenreTemplate.GENRE_FPS,
          name: "GENRE_FPS",
          description: "First-person shooter movement (AimDownSights, Fire, Reload, Recoil)",
          supportedIntents: StandardGenreTemplates[GenreTemplate.GENRE_FPS].supportedIntents,
        },
        {
          id: GenreTemplate.GENRE_ACTION_RPG,
          name: "GENRE_ACTION_RPG",
          description: "Combat RPG actions (AttackLight, HeavyAttack, DodgeRoll, Block, CastSpell)",
          supportedIntents: StandardGenreTemplates[GenreTemplate.GENRE_ACTION_RPG].supportedIntents,
        },
        {
          id: GenreTemplate.GENRE_VEHICLE,
          name: "GENRE_VEHICLE",
          description: "Vehicle physics (Accelerate, Brake, Reverse, Drift, Handbrake)",
          supportedIntents: StandardGenreTemplates[GenreTemplate.GENRE_VEHICLE].supportedIntents,
        },
      ],
      layers: [
        { id: AnimationLayer.LAYER_FULL_BODY, name: "LAYER_FULL_BODY", priorityOrder: 0 },
        { id: AnimationLayer.LAYER_LOWER_BODY, name: "LAYER_LOWER_BODY", priorityOrder: 1 },
        { id: AnimationLayer.LAYER_UPPER_BODY, name: "LAYER_UPPER_BODY", priorityOrder: 2 },
        { id: AnimationLayer.LAYER_ADDITIVE, name: "LAYER_ADDITIVE", priorityOrder: 3 },
      ],
      blendCurves: ["LINEAR", "SMOOTHSTEP", "S_CURVE", "EXPONENTIAL", "INSTANT"],
    };

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(templates, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  });

  // 7. physics://memory/failures
  server.resource("memory_failures", "physics://memory/failures", async (uri) => {
    let failureCount = 0;
    let recentFailures: any[] = [];

    if (deps.vectorStore && deps.vectorStore.isOpen()) {
      try {
        const dummyQuery = new Array(deps.vectorStore.defaultDimension).fill(0);
        dummyQuery[0] = 1.0;
        recentFailures = await deps.vectorStore.searchSimilarFailures(dummyQuery, 10, -1.0);
        failureCount = recentFailures.length;
      } catch {
        // Fallback if vector store has no entries
      }
    }

    const payload = {
      totalFailuresStored: failureCount,
      recentFailures: recentFailures.map((f) => ({
        failureId: f.failureId,
        moduleId: f.moduleId,
        failedFrameId: f.failedFrameId.toString(),
        errorLog: f.errorLog,
        hasAstDiff: Boolean(f.astDiff),
        timestamp: f.timestamp,
      })),
    };

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(payload, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  });
}
