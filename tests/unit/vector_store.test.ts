import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  SQLiteVectorStore,
  KeyframeVectorRecord,
  FailureVectorRecord,
  float32ArrayToBuffer,
  bufferToFloat32Array,
  normalizeVector,
} from "../../src/memory/vector_store.js";
import { defaultConfig } from "../../src/config.js";

describe("SQLiteVectorStore (Embedded SQLite-Vector Storage & Custom Functions)", () => {
  let store: SQLiteVectorStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-vector-test-"));
    store = new SQLiteVectorStore(defaultConfig, { inMemory: true });
    await store.initialize();
  });

  afterEach(async () => {
    if (store.isOpen()) {
      await store.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Initialization & Lifecycle", () => {
    it("initializes an in-memory SQLite database and reports isOpen", async () => {
      expect(store.isOpen()).toBe(true);
      expect(store.getDatabasePath()).toBe(":memory:");
    });

    it("initializes a file-based database and creates nested parent directories", async () => {
      const nestedPath = path.join(tempDir, "sub", "nested", "physics.sqlite");
      const fileStore = new SQLiteVectorStore(defaultConfig, { dbPath: nestedPath });
      await fileStore.initialize();

      expect(fileStore.isOpen()).toBe(true);
      expect(fs.existsSync(nestedPath)).toBe(true);

      await fileStore.close();
      expect(fileStore.isOpen()).toBe(false);
    });

    it("throws an error when accessing an uninitialized or closed database", async () => {
      await store.close();
      expect(store.isOpen()).toBe(false);

      await expect(
        store.insertKeyframe({
          keyframeId: "k1",
          frameId: 1n,
          eventName: "collision",
          stateJson: "{}",
          embedding: [1, 0, 0],
          timestamp: Date.now(),
        })
      ).rejects.toThrow("SQLiteVectorStore is not initialized or has been closed");
    });
  });

  describe("Vector Math & SQLite Custom Functions", () => {
    it("converts between Float32Array/number[] and Buffer accurately", () => {
      const original = [1.5, -2.25, 3.125];
      const buffer = float32ArrayToBuffer(original);
      const restored = bufferToFloat32Array(buffer);

      expect(restored.length).toBe(3);
      expect(restored[0]).toBeCloseTo(1.5);
      expect(restored[1]).toBeCloseTo(-2.25);
      expect(restored[2]).toBeCloseTo(3.125);
    });

    it("normalizes vectors to unit Euclidean norm", () => {
      const vec = [3, 4];
      const norm = normalizeVector(vec);
      expect(norm[0]).toBeCloseTo(0.6);
      expect(norm[1]).toBeCloseTo(0.8);
      const len = Math.sqrt(norm[0] * norm[0] + norm[1] * norm[1]);
      expect(len).toBeCloseTo(1.0);
    });

    it("evaluates custom SQLite vector functions: cosine_similarity, l2_distance, dot_product", async () => {
      // Create 3 test vectors:
      // A = [1, 0, 0]
      // B = [0, 1, 0] (orthogonal)
      // C = [0.7071068, 0.7071068, 0] (~45 degrees to A and B)
      const vA = [1, 0, 0];
      const vB = [0, 1, 0];
      const vC = [Math.SQRT1_2, Math.SQRT1_2, 0];
      const vOpposite = [-1, 0, 0];

      await store.insertKeyframe({
        keyframeId: "A",
        frameId: 1n,
        eventName: "test",
        stateJson: "{}",
        embedding: vA,
        timestamp: 1000,
      });

      await store.insertKeyframe({
        keyframeId: "B",
        frameId: 2n,
        eventName: "test",
        stateJson: "{}",
        embedding: vB,
        timestamp: 2000,
      });

      await store.insertKeyframe({
        keyframeId: "C",
        frameId: 3n,
        eventName: "test",
        stateJson: "{}",
        embedding: vC,
        timestamp: 3000,
      });

      await store.insertKeyframe({
        keyframeId: "Opp",
        frameId: 4n,
        eventName: "test",
        stateJson: "{}",
        embedding: vOpposite,
        timestamp: 4000,
      });

      // Search with query A = [1, 0, 0]
      const results = await store.searchSimilarKeyframes(vA, 10);
      expect(results.length).toBe(4);

      // Most similar should be A (cosine sim = 1.0)
      expect(results[0].keyframeId).toBe("A");
      expect(results[0].similarity).toBeCloseTo(1.0);

      // Second should be C (cosine sim = ~0.707)
      expect(results[1].keyframeId).toBe("C");
      expect(results[1].similarity).toBeCloseTo(Math.SQRT1_2, 3);

      // Third should be B (cosine sim = 0.0)
      expect(results[2].keyframeId).toBe("B");
      expect(results[2].similarity).toBeCloseTo(0.0);

      // Fourth should be Opp (cosine sim = -1.0)
      expect(results[3].keyframeId).toBe("Opp");
      expect(results[3].similarity).toBeCloseTo(-1.0);
    });
  });

  describe("Keyframe CRUD Operations", () => {
    it("inserts, retrieves, and hydrates keyframe records with BigInt frameId", async () => {
      const record: KeyframeVectorRecord = {
        keyframeId: "kf_goal_100",
        frameId: 9007199254740993n, // Exceeds Number.MAX_SAFE_INTEGER
        eventName: "goal",
        stateJson: JSON.stringify({ score: 1, team: "blue" }),
        embedding: [0.5, 0.5, 0.5, 0.5],
        timestamp: 1725888000000,
        metadata: { player: "striker_1" },
      };

      await store.insertKeyframe(record);

      const retrieved = await store.getKeyframe("kf_goal_100");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.keyframeId).toBe("kf_goal_100");
      expect(retrieved!.frameId).toBe(9007199254740993n);
      expect(retrieved!.eventName).toBe("goal");
      expect(retrieved!.stateJson).toBe(record.stateJson);
      expect(retrieved!.timestamp).toBe(1725888000000);
      expect(retrieved!.metadata).toEqual({ player: "striker_1" });
      expect(retrieved!.embedding.length).toBe(4);
      expect(retrieved!.embedding[0]).toBeCloseTo(0.5);
    });

    it("returns null when querying non-existent keyframe ID", async () => {
      const retrieved = await store.getKeyframe("non_existent");
      expect(retrieved).toBeNull();
    });

    it("replaces existing record on keyframeId conflict", async () => {
      const kfId = "kf_duplicate";
      await store.insertKeyframe({
        keyframeId: kfId,
        frameId: 10n,
        eventName: "collision",
        stateJson: '{"v": 1}',
        embedding: [1, 0],
        timestamp: 1000,
      });

      await store.insertKeyframe({
        keyframeId: kfId,
        frameId: 20n,
        eventName: "goal",
        stateJson: '{"v": 2}',
        embedding: [0, 1],
        timestamp: 2000,
      });

      expect(await store.countKeyframes()).toBe(1);
      const updated = await store.getKeyframe(kfId);
      expect(updated!.frameId).toBe(20n);
      expect(updated!.eventName).toBe("goal");
    });

    it("queries keyframes by event name and frame range", async () => {
      for (let i = 1; i <= 5; i++) {
        await store.insertKeyframe({
          keyframeId: `collision_${i}`,
          frameId: BigInt(i * 10),
          eventName: "collision",
          stateJson: `{"i": ${i}}`,
          embedding: [i * 0.1, 0],
          timestamp: 1000 + i,
        });
      }

      await store.insertKeyframe({
        keyframeId: "goal_1",
        frameId: 55n,
        eventName: "goal",
        stateJson: '{"goal": true}',
        embedding: [0, 1],
        timestamp: 2000,
      });

      expect(await store.countKeyframes()).toBe(6);
      expect(await store.countKeyframes("collision")).toBe(5);
      expect(await store.countKeyframes("goal")).toBe(1);

      const collisions = await store.getKeyframesByEvent("collision", 3);
      expect(collisions.length).toBe(3);

      const rangeKeyframes = await store.getKeyframesByFrameRange(20n, 40n);
      expect(rangeKeyframes.length).toBe(3);
      expect(rangeKeyframes.map((k) => k.frameId)).toEqual([20n, 30n, 40n]);
    });

    it("deletes keyframes and clears the table", async () => {
      await store.insertKeyframe({
        keyframeId: "to_delete",
        frameId: 1n,
        eventName: "collision",
        stateJson: "{}",
        embedding: [1],
        timestamp: 1,
      });

      expect(await store.countKeyframes()).toBe(1);
      const deleted = await store.deleteKeyframe("to_delete");
      expect(deleted).toBe(true);
      expect(await store.countKeyframes()).toBe(0);

      const nonExistentDelete = await store.deleteKeyframe("unknown");
      expect(nonExistentDelete).toBe(false);

      await store.insertKeyframe({
        keyframeId: "k1",
        frameId: 1n,
        eventName: "e",
        stateJson: "{}",
        embedding: [1],
        timestamp: 1,
      });
      await store.insertKeyframe({
        keyframeId: "k2",
        frameId: 2n,
        eventName: "e",
        stateJson: "{}",
        embedding: [1],
        timestamp: 2,
      });
      expect(await store.countKeyframes()).toBe(2);

      await store.clearKeyframes();
      expect(await store.countKeyframes()).toBe(0);
    });
  });

  describe("Vector Search with Filtering & Thresholds", () => {
    beforeEach(async () => {
      // Insert mixed events with varying directions
      await store.insertKeyframe({
        keyframeId: "coll_high",
        frameId: 10n,
        eventName: "collision",
        stateJson: '{"type":"high_speed"}',
        embedding: [1.0, 0.1, 0.0],
        timestamp: 100,
      });

      await store.insertKeyframe({
        keyframeId: "coll_low",
        frameId: 15n,
        eventName: "collision",
        stateJson: '{"type":"low_speed"}',
        embedding: [0.8, 0.5, 0.0],
        timestamp: 150,
      });

      await store.insertKeyframe({
        keyframeId: "goal_east",
        frameId: 20n,
        eventName: "goal",
        stateJson: '{"type":"goal_scored"}',
        embedding: [0.9, 0.1, 0.0],
        timestamp: 200,
      });

      await store.insertKeyframe({
        keyframeId: "state_diff",
        frameId: 30n,
        eventName: "state_change",
        stateJson: '{"type":"phase"}',
        embedding: [0.0, 1.0, 0.0],
        timestamp: 300,
      });
    });

    it("filters search results by eventNameFilter", async () => {
      const query = [1.0, 0.0, 0.0];
      const collisionResults = await store.searchSimilarKeyframes(query, 5, -1.0, "collision");

      expect(collisionResults.length).toBe(2);
      expect(collisionResults.every((r) => r.eventName === "collision")).toBe(true);
      expect(collisionResults[0].keyframeId).toBe("coll_high");
    });

    it("respects limit and minSimilarity cutoff", async () => {
      const query = [1.0, 0.0, 0.0];

      // Limit = 1
      const top1 = await store.searchSimilarKeyframes(query, 1);
      expect(top1.length).toBe(1);

      // High threshold
      const highSim = await store.searchSimilarKeyframes(query, 5, 0.95);
      expect(highSim.length).toBeGreaterThanOrEqual(1);
      expect(highSim.every((r) => r.similarity >= 0.95)).toBe(true);
    });
  });

  describe("Reflective Failures Storage & Similarity Search", () => {
    it("stores and searches reflective failure logs by diagnostic embedding", async () => {
      const failure1: FailureVectorRecord = {
        failureId: "fail_1",
        moduleId: "gravity_mod",
        failedFrameId: 120n,
        errorLog: "ERROR: NaN detected in velocity calculation",
        astDiff: "--- old\n+++ new",
        embedding: [1, 0, 0, 0],
        timestamp: 1000,
        metadata: { errorCategory: "MATH_DOMAIN" },
      };

      const failure2: FailureVectorRecord = {
        failureId: "fail_2",
        moduleId: "jump_mod",
        failedFrameId: 250n,
        errorLog: "ERROR: Out of bounds position exceeded playtest clamp",
        astDiff: undefined,
        embedding: [0, 1, 0, 0],
        timestamp: 2000,
        metadata: { errorCategory: "OOB" },
      };

      await store.insertFailureRecord(failure1);
      await store.insertFailureRecord(failure2);

      // Search matching failure1
      const query = [0.95, 0.1, 0, 0];
      const results = await store.searchSimilarFailures(query, 5, 0.5);

      expect(results.length).toBe(1);
      expect(results[0].failureId).toBe("fail_1");
      expect(results[0].moduleId).toBe("gravity_mod");
      expect(results[0].failedFrameId).toBe(120n);
      expect(results[0].errorLog).toContain("NaN detected");
      expect(results[0].astDiff).toBe("--- old\n+++ new");
      expect(results[0].metadata?.errorCategory).toBe("MATH_DOMAIN");
      expect(results[0].similarity).toBeGreaterThan(0.9);
    });
  });
});
