import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SQLiteVectorStore,
  KeyframeIndexer,
  PhysicsStateEmbedder,
} from "../../src/memory/index.js";
import { defaultConfig } from "../../src/config.js";
import { HierarchicalSceneTree } from "../../src/ecs/soa_types.js";
import { PhysicsFrameSoA, EngineMode } from "../../src/proto/index.js";

describe("KeyframeIndexer & PhysicsStateEmbedder (Selective RAG Context Management)", () => {
  let store: SQLiteVectorStore;
  let embedder: PhysicsStateEmbedder;
  let indexer: KeyframeIndexer;

  beforeEach(async () => {
    store = new SQLiteVectorStore(defaultConfig, { inMemory: true });
    await store.initialize();
    embedder = new PhysicsStateEmbedder({ dimension: 128 });
    indexer = new KeyframeIndexer(store, embedder, {
      cooldownFrames: 10,
      minStateDelta: 1.0,
    });
  });

  afterEach(async () => {
    if (store.isOpen()) {
      await store.close();
    }
  });

  const createSceneTree = (
    frameId: bigint,
    comPos: [number, number, number] = [0, 0, 0],
    vel: [number, number, number] = [0, 0, 0]
  ): HierarchicalSceneTree => ({
    frameId,
    timestampNs: frameId * 16666667n,
    coordinateSpace: "world",
    entities: [
      {
        id: 1,
        position: { x: comPos[0], y: comPos[1], z: comPos[2] },
        velocity: { x: vel[0], y: vel[1], z: vel[2] },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        radius: 1.0,
        mass: 2.0,
      },
      {
        id: 2,
        parentId: 1,
        position: { x: comPos[0] + 1.0, y: comPos[1], z: comPos[2] },
        velocity: { x: vel[0], y: vel[1], z: vel[2] },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        radius: 0.5,
        mass: 1.0,
      },
    ],
  });

  const createPhysicsFrameSoA = (
    frameId: bigint,
    posX: number[],
    posY: number[],
    posZ: number[],
    velX: number[],
    velY: number[],
    velZ: number[],
    radii: number[] = [1.0, 1.0]
  ): PhysicsFrameSoA => ({
    frameId,
    timestampNs: frameId * 16666667n,
    deltaTime: 0.016667,
    mode: EngineMode.PLAYTEST,
    entityIds: [1, 2],
    posX,
    posY,
    posZ,
    velX,
    velY,
    velZ,
    rotX: [0, 0],
    rotY: [0, 0],
    rotZ: [0, 0],
    rotW: [1, 1],
    radii,
    masses: [1.0, 1.0],
  });

  describe("PhysicsStateEmbedder", () => {
    it("generates normalized 128-dimensional unit vectors", () => {
      const tree = createSceneTree(1n, [5, 2, -3], [10, 0, 0]);
      const vec = embedder.embedSceneTree(tree, "collision");

      expect(vec.length).toBe(128);

      let sumSq = 0;
      for (const val of vec) {
        sumSq += val * val;
      }
      expect(Math.sqrt(sumSq)).toBeCloseTo(1.0);
    });

    it("evaluates high cosine similarity for similar kinematics and lower for divergent states", () => {
      // Scene 1: Collision at [10, 0, 0] with velocity [5, 0, 0]
      const scene1 = createSceneTree(100n, [10, 0, 0], [5, 0, 0]);
      const emb1 = embedder.embedSceneTree(scene1, "collision");

      // Scene 2: Very similar collision at [10.2, 0, 0] with velocity [4.8, 0, 0]
      const scene2 = createSceneTree(101n, [10.2, 0, 0], [4.8, 0, 0]);
      const emb2 = embedder.embedSceneTree(scene2, "collision");

      // Scene 3: Stationary goal reached at [-50, 10, 20] with velocity [0, 0, 0]
      const scene3 = createSceneTree(200n, [-50, 10, 20], [0, 0, 0]);
      const emb3 = embedder.embedSceneTree(scene3, "goal");

      const cosineSim = (a: number[], b: number[]): number => {
        let dot = 0;
        for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
        return dot;
      };

      const simSimilar = cosineSim(emb1, emb2);
      const simDivergent = cosineSim(emb1, emb3);

      expect(simSimilar).toBeGreaterThan(0.90);
      expect(simSimilar).toBeGreaterThan(simDivergent + 0.3);
    });

    it("generates normalized embeddings from flat PhysicsFrameSoA", () => {
      const frame = createPhysicsFrameSoA(
        10n,
        [0, 2],
        [0, 0],
        [0, 0],
        [1, -1],
        [0, 0],
        [0, 0]
      );
      const vec = embedder.embedPhysicsFrame(frame, "collision");

      expect(vec.length).toBe(128);
      const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
      expect(norm).toBeCloseTo(1.0);
    });

    it("generates text query embeddings with semantic keyword projection", () => {
      const embColl = embedder.embedText("severe high speed collision");
      const embImpact = embedder.embedText("entity impact contact");
      const embGoal = embedder.embedText("goal scored objective completed");

      const cosineSim = (a: number[], b: number[]): number => {
        let dot = 0;
        for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
        return dot;
      };

      const collVsImpact = cosineSim(embColl, embImpact);
      const collVsGoal = cosineSim(embColl, embGoal);

      expect(collVsImpact).toBeGreaterThan(collVsGoal);
    });
  });

  describe("Selective Keyframe Indexing & Context Bloat Defense", () => {
    it("indexes explicit keyframe events and saves compact JSON state", async () => {
      const tree = createSceneTree(50n, [2, 3, 4], [1, 0, 0]);
      const record = await indexer.indexKeyframeEvent("collision", tree);

      expect(record).not.toBeNull();
      expect(record!.eventName).toBe("collision");
      expect(record!.frameId).toBe(50n);
      expect(record!.stateJson).toContain('"pos":[2,3,4]');

      const stored = await store.getKeyframe(record!.keyframeId);
      expect(stored).not.toBeNull();
      expect(stored!.frameId).toBe(50n);
    });

    it("indexes directly from flat PhysicsFrameSoA via DataTranslationLayer", async () => {
      const frame = createPhysicsFrameSoA(
        120n,
        [10, 20],
        [0, 0],
        [5, 5],
        [2, -2],
        [0, 0],
        [0, 0]
      );

      const record = await indexer.indexPhysicsFrame("goal", frame);
      expect(record).not.toBeNull();
      expect(record!.eventName).toBe("goal");
      expect(record!.frameId).toBe(120n);
      expect(record!.stateJson).toContain('"id":1');
      expect(record!.stateJson).toContain('"id":2');
    });

    it("throttles duplicate events within cooldown period to prevent context bloat", async () => {
      // Frame 100: collision event indexed
      const tree1 = createSceneTree(100n, [0, 0, 0], [1, 0, 0]);
      const record1 = await indexer.indexKeyframeEvent("collision", tree1);
      expect(record1).not.toBeNull();

      // Frame 103 (within 10-frame cooldown, minimal delta): should be throttled
      const tree2 = createSceneTree(103n, [0.1, 0, 0], [1, 0, 0]);
      const record2 = await indexer.indexKeyframeEvent("collision", tree2);
      expect(record2).toBeNull();
      expect(indexer.getThrottledCount()).toBe(1);

      // Frame 106 (still within cooldown, but significant state change > minStateDelta): should NOT be throttled
      const tree3 = createSceneTree(106n, [5.0, 0, 0], [10, 0, 0]);
      const record3 = await indexer.indexKeyframeEvent("collision", tree3);
      expect(record3).not.toBeNull();

      // Frame 120 (past 10-frame cooldown): should NOT be throttled
      const tree4 = createSceneTree(120n, [5.1, 0, 0], [10, 0, 0]);
      const record4 = await indexer.indexKeyframeEvent("collision", tree4);
      expect(record4).not.toBeNull();

      expect(await store.countKeyframes("collision")).toBe(3);
    });

    it("allows bypassing cooldown when requested", async () => {
      const tree1 = createSceneTree(10n, [0, 0, 0]);
      const tree2 = createSceneTree(12n, [0, 0, 0]);

      await indexer.indexKeyframeEvent("goal", tree1);
      const forcedRecord = await indexer.indexKeyframeEvent("goal", tree2, {
        bypassCooldown: true,
      });

      expect(forcedRecord).not.toBeNull();
      expect(await store.countKeyframes("goal")).toBe(2);
    });
  });

  describe("Event Detection Helpers", () => {
    it("detects entity collision contacts and computes penetration depth", () => {
      // Entity 1 at [0, 0, 0] with radius 1.0
      // Entity 2 at [1.5, 0, 0] with radius 1.0
      // Distance = 1.5, minDist = 2.0 -> penetration = 0.5
      const collidingFrame = createPhysicsFrameSoA(
        1n,
        [0, 1.5],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [1.0, 1.0]
      );

      const collisions = indexer.detectCollisionEvents(collidingFrame);
      expect(collisions.length).toBe(1);
      expect(collisions[0].entityA).toBe(1);
      expect(collisions[0].entityB).toBe(2);
      expect(collisions[0].distance).toBeCloseTo(1.5);
      expect(collisions[0].penetrationDepth).toBeCloseTo(0.5);

      // Non-colliding frame: distance = 5.0 > 2.0
      const separatedFrame = createPhysicsFrameSoA(
        2n,
        [0, 5.0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [1.0, 1.0]
      );
      expect(indexer.detectCollisionEvents(separatedFrame).length).toBe(0);
    });

    it("detects significant velocity state changes between frames", () => {
      const prevTree = createSceneTree(10n, [0, 0, 0], [0, 0, 0]);
      const minorTree = createSceneTree(11n, [0, 0, 0], [0.5, 0, 0]);
      const majorTree = createSceneTree(12n, [0, 0, 0], [5.0, 0, 0]);

      // Minor change with threshold = 2.0 -> false
      expect(indexer.detectStateChange(minorTree, prevTree, 2.0)).toBe(false);

      // Major change with threshold = 2.0 -> true
      expect(indexer.detectStateChange(majorTree, prevTree, 2.0)).toBe(true);
    });
  });

  describe("RAG Retrieval & Prompt Context Formatting", () => {
    beforeEach(async () => {
      // Index 3 distinct historical keyframes
      const collisionTree = createSceneTree(50n, [10, 0, 0], [5, 0, 0]);
      const goalTree = createSceneTree(100n, [0, 10, 0], [0, 0, 0]);
      const phaseTree = createSceneTree(150n, [-20, 0, 10], [-2, 0, 1]);

      await indexer.indexKeyframeEvent("collision", collisionTree, { bypassCooldown: true });
      await indexer.indexKeyframeEvent("goal", goalTree, { bypassCooldown: true });
      await indexer.indexKeyframeEvent("state_change", phaseTree, { bypassCooldown: true });
    });

    it("retrieves most relevant historical keyframe given current physics state", async () => {
      // Query with a state near the collision
      const queryTree = createSceneTree(180n, [9.8, 0.1, 0], [4.9, 0, 0]);
      const results = await indexer.queryContextForEvent("collision", queryTree, 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].eventName).toBe("collision");
      expect(results[0].similarity).toBeGreaterThan(0.9);
    });

    it("retrieves historical keyframe using natural language text search", async () => {
      const results = await indexer.queryContextByText("goal target scored", 3);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].eventName).toBe("goal");
    });

    it("formats retrieved keyframes into token-efficient Markdown context for AI prompts", async () => {
      const queryTree = createSceneTree(200n, [10, 0, 0], [5, 0, 0]);
      const results = await indexer.queryContextForEvent("collision", queryTree, 2);

      const promptContext = indexer.formatRAGPromptContext(results);

      expect(promptContext).toContain("### Relevant Keyframe History (RAG Context)");
      expect(promptContext).toContain("Keyframe `collision_50_");
      expect(promptContext).toContain('Event: `collision`');
      expect(promptContext).toContain("Sim:");
      expect(promptContext).toContain('"pos":[10,0,0]');
    });

    it("returns graceful fallback message when no keyframes match", () => {
      const promptContext = indexer.formatRAGPromptContext([]);
      expect(promptContext).toBe("No historical keyframe context found.");
    });
  });

  describe("Reflective Failure Indexing", () => {
    it("indexes reflective failure reports into vector store with diagnostic text", async () => {
      const failureRecord = await indexer.indexFailure(
        {
          moduleId: "steering_controller",
          failedFrameId: 300n,
          astDiff: "--- old\n+++ new",
          compressedErrorLogs: "ERROR: Angular velocity exceeded clamp threshold",
          diagnosticTrace: {
            executionTimeNs: 50000n,
            compileTimeNs: 0n,
            memoryBytesUsed: 2048,
            instructionsExecuted: 100n,
            cacheHit: true,
            sandboxExitCode: 1,
            consoleLogs: ["Steering clamped"],
            callStack: "",
            errorCategory: "ANGULAR_VEL_CLAMP",
          },
        },
        "ERROR: Angular velocity exceeded clamp threshold"
      );

      expect(failureRecord).not.toBeNull();
      expect(failureRecord.moduleId).toBe("steering_controller");
      expect(failureRecord.failedFrameId).toBe(300n);
      expect(failureRecord.metadata?.errorCategory).toBe("ANGULAR_VEL_CLAMP");

      const query = embedder.embedText("steering angular velocity clamp error");
      const results = await store.searchSimilarFailures(query, 5, 0.5);
      expect(results.length).toBe(1);
      expect(results[0].moduleId).toBe("steering_controller");
    });
  });
});
