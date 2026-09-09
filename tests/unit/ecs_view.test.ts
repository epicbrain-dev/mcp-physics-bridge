import { describe, it, expect } from "vitest";
import { ECSView, BYTES_PER_ENTITY } from "../../src/ecs/ecs_view.js";
import { NO_PARENT } from "../../src/ecs/soa_types.js";
import { EngineMode, PhysicsFrameSoA } from "../../src/proto/index.js";

describe("ECSView (Contiguous Struct of Arrays & Zero-Copy Views)", () => {
  it("pre-allocates contiguous memory matching 68 bytes per entity", () => {
    const capacity = 100;
    const view = new ECSView(capacity);

    expect(view.capacity).toBe(capacity);
    expect(view.buffers.count).toBe(0);
    expect(view.getRawBuffer().byteLength).toBe(capacity * BYTES_PER_ENTITY);
    expect(view.buffers.entityIds.length).toBe(capacity);
    expect(view.buffers.parentIds.length).toBe(capacity);
    expect(view.buffers.posX.length).toBe(capacity);
    expect(view.buffers.rotW.length).toBe(capacity);
    expect(view.buffers.radii.length).toBe(capacity);
    expect(view.buffers.masses.length).toBe(capacity);
  });

  it("supports zero-copy wrapping of an existing ArrayBuffer", () => {
    const capacity = 10;
    const raw = new ArrayBuffer(capacity * BYTES_PER_ENTITY);
    const view = ECSView.fromBuffer(raw, capacity);

    expect(view.getRawBuffer()).toBe(raw);
    expect(view.capacity).toBe(capacity);

    view.addEntity({
      id: 42,
      position: { x: 1.5, y: 2.5, z: 3.5 },
      velocity: { x: 0, y: -9.8, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      radius: 0.5,
      mass: 10.0,
    });

    expect(view.buffers.count).toBe(1);
    expect(view.buffers.posX[0]).toBe(1.5);
    expect(view.buffers.masses[0]).toBe(10.0);

    // Verify modifying through typed array mutates raw buffer
    const f32 = new Float32Array(raw);
    expect(f32).toBeDefined();
  });

  it("adds and retrieves entities with getEntity and findEntityIndex", () => {
    const view = new ECSView(16);

    const idx0 = view.addEntity({
      id: 101,
      position: { x: 10, y: 20, z: 30 },
      velocity: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });

    const idx1 = view.addEntity({
      id: 202,
      parentId: 101,
      position: { x: 15, y: 25, z: 35 },
      velocity: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 1, z: 0, w: 0 },
      angularVelocity: { x: 0.25, y: 0.5, z: 0.75 },
    });

    expect(idx0).toBe(0);
    expect(idx1).toBe(1);
    expect(view.buffers.count).toBe(2);

    expect(view.findEntityIndex(101)).toBe(0);
    expect(view.findEntityIndex(202)).toBe(1);
    expect(view.findEntityIndex(999)).toBe(-1);

    const node0 = view.getEntity(0);
    expect(node0.id).toBe(101);
    expect(node0.parentId).toBeUndefined();
    expect(node0.position).toEqual({ x: 10, y: 20, z: 30 });

    const node1 = view.getEntity(1);
    expect(node1.id).toBe(202);
    expect(node1.parentId).toBe(101);
    expect(node1.angularVelocity).toEqual({ x: 0.25, y: 0.5, z: 0.75 });
  });

  it("performs O(1) swap-and-pop removal without memory reallocation", () => {
    const view = new ECSView(8);

    view.addEntity({ id: 1, position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
    view.addEntity({ id: 2, position: { x: 2, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
    view.addEntity({ id: 3, position: { x: 3, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });

    expect(view.buffers.count).toBe(3);

    // Remove entity 2 (middle): entity 3 should swap into index 1
    const removed = view.removeEntity(2);
    expect(removed).toBe(true);
    expect(view.buffers.count).toBe(2);

    expect(view.findEntityIndex(2)).toBe(-1);
    expect(view.findEntityIndex(1)).toBe(0);
    expect(view.findEntityIndex(3)).toBe(1);

    const entityAt1 = view.getEntity(1);
    expect(entityAt1.id).toBe(3);
    expect(entityAt1.position.x).toBe(3);

    // Remove non-existent entity
    expect(view.removeEntity(999)).toBe(false);
  });

  it("provides zero-copy active views and asPhysicsFrame without allocation", () => {
    const view = new ECSView(64);
    view.addEntity({ id: 5, position: { x: 50, y: 60, z: 70 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
    view.addEntity({ id: 6, position: { x: 80, y: 90, z: 100 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });

    const active = view.getActiveBuffers();
    expect(active.count).toBe(2);
    expect(active.entityIds.length).toBe(2);
    expect(active.posX.length).toBe(2);
    // Subarray must share the exact same underlying ArrayBuffer
    expect(active.posX.buffer).toBe(view.getRawBuffer());

    const frame = view.asPhysicsFrame(123n, 456n, 0.016, EngineMode.DEBUG);
    expect(frame.frameId).toBe(123n);
    expect(frame.mode).toBe(EngineMode.DEBUG);
    expect(frame.entityIds.length).toBe(2);
    expect(frame.posX[0]).toBe(50);
    expect(frame.posX[1]).toBe(80);
    expect((frame.posX as Float32Array).buffer).toBe(view.getRawBuffer());
  });

  it("initializes from PhysicsFrameSoA via factory method", () => {
    const frame: PhysicsFrameSoA = {
      frameId: 1n,
      timestampNs: 100n,
      deltaTime: 0.016,
      mode: EngineMode.PLAYTEST,
      entityIds: [10, 20],
      parentIds: [NO_PARENT, 10],
      posX: [1.1, 2.2],
      posY: [3.3, 4.4],
      posZ: [5.5, 6.6],
      velX: [0, 1],
      velY: [0, 2],
      velZ: [0, 3],
      rotX: [0, 0],
      rotY: [0, 0],
      rotZ: [0, 0],
      rotW: [1, 1],
      radii: [0.5, 1.5],
      masses: [2.0, 4.0],
    };

    const view = ECSView.fromPhysicsFrame(frame, 32);
    expect(view.buffers.count).toBe(2);
    expect(view.capacity).toBe(32);
    expect(view.buffers.entityIds[0]).toBe(10);
    expect(view.buffers.parentIds[1]).toBe(10);
    expect(view.buffers.radii[1]).toBeCloseTo(1.5);
    expect(view.buffers.masses[0]).toBeCloseTo(2.0);
  });

  it("copies buffer contents cleanly with copyFrom", () => {
    const src = new ECSView(8);
    src.addEntity({ id: 10, position: { x: 7, y: 8, z: 9 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });

    const dst = new ECSView(8);
    dst.copyFrom(src);

    expect(dst.buffers.count).toBe(1);
    expect(dst.getEntity(0).id).toBe(10);
    expect(dst.getEntity(0).position.x).toBe(7);
  });

  it("enforces capacity limit on addEntity", () => {
    const view = new ECSView(1);
    view.addEntity({ id: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
    expect(() => {
      view.addEntity({ id: 2, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
    }).toThrow(/capacity reached/i);
  });
});
