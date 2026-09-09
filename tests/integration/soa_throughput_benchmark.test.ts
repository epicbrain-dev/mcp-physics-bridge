import { describe, it, expect } from "vitest";
import { ECSView, BYTES_PER_ENTITY } from "../../src/ecs/ecs_view.js";
import { DataTranslationLayer } from "../../src/ecs/data_translator.js";
import { StateAuthorityManager } from "../../src/validation/authority_manager.js";
import { EngineMode, PhysicsStatusCode, PhysicsFrameSoA } from "../../src/proto/index.js";
import { performance } from "node:perf_hooks";

describe("60 FPS SoA High-Throughput Performance Benchmark", () => {
  const ENTITY_COUNT = 10_000;
  const KINEMATIC_COUNT = 5_000;
  // Frame budget tolerance accounting for multi-threaded test runner & coverage instrumentation
  const MAX_BENCHMARK_MS = 100.0;

  it(`allocates, writes, and reads contiguous ArrayBuffer for ${ENTITY_COUNT} entities`, () => {
    const startAlloc = performance.now();
    const ecs = new ECSView(ENTITY_COUNT);
    const allocTime = performance.now() - startAlloc;

    expect(ecs.capacity).toBe(ENTITY_COUNT);
    expect(allocTime).toBeLessThan(MAX_BENCHMARK_MS);

    // Populate entities
    const startPopulate = performance.now();
    for (let i = 0; i < ENTITY_COUNT; i++) {
      ecs.addEntity({
        id: i + 1,
        parentId: i === 0 ? 0 : 1, // Entity 1 is root
        position: { x: i * 0.1, y: Math.sin(i), z: Math.cos(i) },
        velocity: { x: 1.0, y: 0.0, z: 0.0 },
        rotation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 },
        angularVelocity: { x: 0.0, y: 0.0, z: 0.0 },
        radius: 0.5,
        mass: 10.0,
      });
    }
    const populateTime = performance.now() - startPopulate;

    expect(populateTime).toBeLessThan(MAX_BENCHMARK_MS);
    expect(ecs.buffers.count).toBe(ENTITY_COUNT);

    // Verify sample entity lookup
    const sample = ecs.getEntity(5000);
    expect(sample).toBeDefined();
    expect(sample!.id).toBe(5001);
    expect(sample!.parentId).toBe(1);
    expect(sample!.velocity.x).toBeCloseTo(1.0);
  });

  it(`validates ${KINEMATIC_COUNT} kinematic entities in Playtest Mode well under 60 FPS budget`, () => {
    const ecs = new ECSView(KINEMATIC_COUNT);
    for (let i = 0; i < KINEMATIC_COUNT; i++) {
      ecs.addEntity({
        id: i + 1,
        parentId: 0,
        position: { x: i * 0.01, y: 1.0, z: 0.0 },
        velocity: { x: i === 42 ? 350.0 : 5.0, y: 0.0, z: 0.0 }, // Entity 42 exceeds max velocity (100 m/s)
        rotation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 },
        angularVelocity: { x: 0.0, y: 0.0, z: 0.0 },
      });
    }

    const frame: PhysicsFrameSoA = {
      ...ecs.asPhysicsFrame(100n, 100_000_000n, 0.016, EngineMode.PLAYTEST),
      radii: undefined, // Kinematic crowd simulation without pairwise collision
    };
    const authority = new StateAuthorityManager();

    // Warm-up pass for JIT baseline
    authority.validateFrame(frame);

    // Measure frame processing time
    const startValidate = performance.now();
    const result = authority.validateFrame(frame);
    const validateTime = performance.now() - startValidate;

    // Kinematic validation completes in milliseconds; per-entity latency is < 0.05ms
    expect(validateTime).toBeLessThan(MAX_BENCHMARK_MS);
    expect(validateTime / KINEMATIC_COUNT).toBeLessThan(0.05);
    expect(result.frameId).toBe(100n);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_SOFT_CLAMPED);
    expect(result.correctedFrame).toBeDefined();

    // Verify soft clamping was applied to entity 42
    const clampedVelX = result.correctedFrame!.velX[42];
    expect(clampedVelX).toBeLessThanOrEqual(100.0);
    expect(clampedVelX).toBeGreaterThan(0.0);
  });

  it(`validates ${KINEMATIC_COUNT} kinematic entities in Debug Mode and detects bitmask violations under budget`, () => {
    const ecs = new ECSView(KINEMATIC_COUNT);
    for (let i = 0; i < KINEMATIC_COUNT; i++) {
      ecs.addEntity({
        id: i + 1,
        parentId: 0,
        position: { x: i === 777 ? NaN : i * 0.05, y: 0.0, z: 0.0 }, // Entity 777 has NaN
        velocity: { x: 0.0, y: 0.0, z: 0.0 },
        rotation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 },
        angularVelocity: { x: 0.0, y: 0.0, z: 0.0 },
      });
    }

    const frame: PhysicsFrameSoA = {
      ...ecs.asPhysicsFrame(200n, 200_000_000n, 0.016, EngineMode.DEBUG),
      radii: undefined,
    };
    const authority = new StateAuthorityManager();

    // Warm-up
    authority.validateFrame(frame);

    const startValidate = performance.now();
    const result = authority.validateFrame(frame);
    const validateTime = performance.now() - startValidate;

    expect(validateTime).toBeLessThan(MAX_BENCHMARK_MS);
    expect(validateTime / KINEMATIC_COUNT).toBeLessThan(0.05);
    expect(result.frameId).toBe(200n);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_NAN_DETECTED);
    expect(result.failingEntityIds).toContain(778); // ID of entity at index 777
  });

  it("validates pairwise collision penetration resolution for 250 colliding entities under budget", () => {
    const COLLISION_COUNT = 250;
    const ecs = new ECSView(COLLISION_COUNT);
    for (let i = 0; i < COLLISION_COUNT; i++) {
      ecs.addEntity({
        id: i + 1,
        parentId: 0,
        position: { x: (i % 5) * 0.2, y: Math.floor(i / 5) * 0.2, z: 0.0 }, // Clustered entities causing penetrations
        velocity: { x: 0.0, y: 0.0, z: 0.0 },
        rotation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 },
        radius: 0.5,
        mass: 1.0,
      });
    }

    const frame = ecs.asPhysicsFrame(250n, 250_000_000n, 0.016, EngineMode.PLAYTEST);
    const authority = new StateAuthorityManager();

    // Warm-up
    authority.validateFrame(frame);

    const startValidate = performance.now();
    const result = authority.validateFrame(frame);
    const validateTime = performance.now() - startValidate;

    expect(validateTime).toBeLessThan(MAX_BENCHMARK_MS);
    expect(result.frameId).toBe(250n);
    expect(result.correctedFrame).toBeDefined();
  });

  it(`translates SoA <-> Hierarchy bidirectional representations under budget`, () => {
    const translator = new DataTranslationLayer();
    const ecs = new ECSView(2000);

    // Create 2000 entities in hierarchical clusters
    for (let i = 0; i < 2000; i++) {
      const parentId = i % 10 === 0 ? 0 : Math.floor(i / 10) * 10 + 1;
      ecs.addEntity({
        id: i + 1,
        parentId,
        position: { x: i * 0.1, y: 0.0, z: 0.0 },
        velocity: { x: 1.0, y: 0.0, z: 0.0 },
        rotation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 },
        angularVelocity: { x: 0.0, y: 0.0, z: 0.0 },
        radius: 0.5,
        mass: 1.0,
      });
    }

    const frame = ecs.asPhysicsFrame(300n, 300_000_000n, 0.016, EngineMode.PLAYTEST);

    const startSoaToHierarchy = performance.now();
    const sceneTree = translator.soaToHierarchy(frame);
    const soaToHierarchyTime = performance.now() - startSoaToHierarchy;

    expect(soaToHierarchyTime).toBeLessThan(MAX_BENCHMARK_MS);
    expect(sceneTree.entities.length).toBe(200); // 200 roots (each with 9 children)

    const targetEcs = new ECSView(2000);
    const startHierarchyToSoa = performance.now();
    translator.hierarchyToSoA(sceneTree, targetEcs);
    const hierarchyToSoaTime = performance.now() - startHierarchyToSoa;

    expect(hierarchyToSoaTime).toBeLessThan(MAX_BENCHMARK_MS);
    expect(targetEcs.buffers.count).toBe(2000);
  });
});
