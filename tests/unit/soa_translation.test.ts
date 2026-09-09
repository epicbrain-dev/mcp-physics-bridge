import { describe, it, expect } from "vitest";
import { DataTranslationLayer } from "../../src/ecs/data_translator.js";
import { ECSView } from "../../src/ecs/ecs_view.js";
import { NO_PARENT, HierarchicalSceneTree } from "../../src/ecs/soa_types.js";
import { EngineMode, PhysicsFrameSoA } from "../../src/proto/index.js";

describe("DataTranslationLayer (SoA <-> Hierarchical Tree)", () => {
  it("translates flat Struct of Arrays into hierarchical objects", () => {
    const translator = new DataTranslationLayer();

    const mockFrame: PhysicsFrameSoA = {
      frameId: 100n,
      timestampNs: 1000000n,
      deltaTime: 0.0166,
      mode: EngineMode.PLAYTEST,
      entityIds: [1, 2],
      posX: [10.0, 20.0],
      posY: [15.0, 25.0],
      posZ: [0.0, 0.0],
      velX: [1.0, 2.0],
      velY: [0.0, 0.0],
      velZ: [0.0, 0.0],
      rotX: [0.0, 0.0],
      rotY: [0.0, 0.0],
      rotZ: [0.0, 0.0],
      rotW: [1.0, 1.0],
    };

    const tree = translator.soaToHierarchy(mockFrame);
    expect(tree.frameId).toBe(100n);
    expect(tree.entities).toHaveLength(2);
    expect(tree.entities[0].id).toBe(1);
    expect(tree.entities[0].position.x).toBe(10.0);
    expect(tree.entities[1].id).toBe(2);
    expect(tree.entities[1].velocity.x).toBe(2.0);
  });

  it("assembles nested parent-child hierarchies from parentIds", () => {
    const translator = new DataTranslationLayer();

    // 1: Root Character, 2: Torso (child of 1), 3: Arm (child of 2)
    const frame: PhysicsFrameSoA = {
      frameId: 1n,
      timestampNs: 1000n,
      deltaTime: 0.016,
      mode: EngineMode.PLAYTEST,
      entityIds: [1, 2, 3],
      parentIds: [NO_PARENT, 1, 2],
      posX: [0, 0, 0.5],
      posY: [0, 1.0, 1.2],
      posZ: [0, 0, 0],
      velX: [1, 1, 1.2],
      velY: [0, 0, 0],
      velZ: [0, 0, 0],
      rotX: [0, 0, 0],
      rotY: [0, 0, 0],
      rotZ: [0, 0, 0],
      rotW: [1, 1, 1],
    };

    const tree = translator.soaToHierarchy(frame, {
      nameMap: new Map([
        [1, "CharacterRoot"],
        [2, "Torso"],
        [3, "Arm"],
      ]),
    });

    expect(tree.entities).toHaveLength(1);
    const root = tree.entities[0];
    expect(root.id).toBe(1);
    expect(root.name).toBe("CharacterRoot");
    expect(root.children).toHaveLength(1);

    const torso = root.children![0];
    expect(torso.id).toBe(2);
    expect(torso.name).toBe("Torso");
    expect(torso.children).toHaveLength(1);

    const arm = torso.children![0];
    expect(arm.id).toBe(3);
    expect(arm.name).toBe("Arm");
    expect(arm.position.x).toBe(0.5);
  });

  it("flattens nested scene hierarchy back into contiguous SoA buffers", () => {
    const translator = new DataTranslationLayer();

    const tree: HierarchicalSceneTree = {
      frameId: 50n,
      timestampNs: 5000n,
      entities: [
        {
          id: 10,
          position: { x: 5, y: 5, z: 5 },
          velocity: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          children: [
            {
              id: 20,
              parentId: 10,
              position: { x: 5, y: 6, z: 5 },
              velocity: { x: 1, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              children: [
                {
                  id: 30,
                  parentId: 20,
                  position: { x: 6, y: 6, z: 5 },
                  velocity: { x: 1, y: 1, z: 0 },
                  rotation: { x: 0, y: 0, z: 0, w: 1 },
                },
              ],
            },
          ],
        },
      ],
    };

    const targetView = new ECSView(8);
    translator.hierarchyToSoA(tree, targetView);

    expect(targetView.buffers.count).toBe(3);
    expect(targetView.buffers.entityIds[0]).toBe(10);
    expect(targetView.buffers.parentIds[0]).toBe(NO_PARENT);
    expect(targetView.buffers.entityIds[1]).toBe(20);
    expect(targetView.buffers.parentIds[1]).toBe(10);
    expect(targetView.buffers.entityIds[2]).toBe(30);
    expect(targetView.buffers.parentIds[2]).toBe(20);
    expect(targetView.buffers.posX[0]).toBe(5);
    expect(targetView.buffers.posY[1]).toBe(6);
    expect(targetView.buffers.posX[2]).toBe(6);
  });

  it("computes local kinematic transforms and flattens back to world transforms", () => {
    const translator = new DataTranslationLayer();

    // Parent at (10, 0, 0), Child at world (15, 0, 0)
    const frame: PhysicsFrameSoA = {
      frameId: 1n,
      timestampNs: 100n,
      deltaTime: 0.016,
      mode: EngineMode.PLAYTEST,
      entityIds: [1, 2],
      parentIds: [NO_PARENT, 1],
      posX: [10, 15],
      posY: [0, 0],
      posZ: [0, 0],
      velX: [1, 3],
      velY: [0, 0],
      velZ: [0, 0],
      rotX: [0, 0],
      rotY: [0, 0],
      rotZ: [0, 0],
      rotW: [1, 1],
    };

    // 1. Translate to hierarchy with local transforms
    const localTree = translator.soaToHierarchy(frame, { computeLocalTransforms: true });
    expect(localTree.coordinateSpace).toBe("local");
    const parent = localTree.entities[0];
    expect(parent.position.x).toBe(10);
    const child = parent.children![0];
    // Child local x should be (15 - 10) = 5
    expect(child.position.x).toBeCloseTo(5);
    // Child local velX should be (3 - 1) = 2
    expect(child.velocity.x).toBeCloseTo(2);

    // 2. Flatten back into SoA - should restore world coordinates (15, 0, 0)
    const ecs = new ECSView(4);
    translator.hierarchyToSoA(localTree, ecs);
    expect(ecs.buffers.count).toBe(2);
    expect(ecs.buffers.posX[0]).toBeCloseTo(10);
    expect(ecs.buffers.posX[1]).toBeCloseTo(15);
    expect(ecs.buffers.velX[1]).toBeCloseTo(3);
  });

  it("filters subtrees for focused AI context reasoning", () => {
    const translator = new DataTranslationLayer();

    const tree: HierarchicalSceneTree = {
      frameId: 1n,
      timestampNs: 1n,
      entities: [
        {
          id: 1,
          name: "WorldEnvironment",
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
        {
          id: 10,
          name: "PlayerVehicle",
          position: { x: 50, y: 0, z: 0 },
          velocity: { x: 10, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          children: [
            {
              id: 11,
              name: "FrontLeftWheel",
              parentId: 10,
              position: { x: 51, y: 0, z: 1 },
              velocity: { x: 10, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
            },
          ],
        },
      ],
    };

    const playerSubtree = translator.filterSubtree(tree, 10);
    expect(playerSubtree.entities).toHaveLength(1);
    expect(playerSubtree.entities[0].id).toBe(10);
    expect(playerSubtree.entities[0].name).toBe("PlayerVehicle");
    expect(playerSubtree.entities[0].children).toHaveLength(1);
    expect(playerSubtree.entities[0].children![0].id).toBe(11);
  });

  it("prunes distant entities with spatial radius filtering", () => {
    const translator = new DataTranslationLayer();

    const tree: HierarchicalSceneTree = {
      frameId: 1n,
      timestampNs: 1n,
      entities: [
        {
          id: 1, // Close entity (distance = 2)
          position: { x: 2, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
        {
          id: 2, // Distant entity (distance = 100)
          position: { x: 100, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
    };

    const nearbyTree = translator.filterSpatialRadius(tree, { x: 0, y: 0, z: 0 }, 10);
    expect(nearbyTree.entities).toHaveLength(1);
    expect(nearbyTree.entities[0].id).toBe(1);
  });

  it("serializes and deserializes token-efficient compact JSON for LLMs", () => {
    const translator = new DataTranslationLayer();

    const tree: HierarchicalSceneTree = {
      frameId: 999n,
      timestampNs: 123456789n,
      entities: [
        {
          id: 7,
          name: "Drone",
          position: { x: 1.234567, y: 2.345678, z: 3.456789 },
          velocity: { x: 0.11111, y: 0.22222, z: 0.33333 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          radius: 0.75,
          mass: 2.5,
          children: [
            {
              id: 8,
              name: "Propeller",
              parentId: 7,
              position: { x: 1.234567, y: 3.0, z: 3.456789 },
              velocity: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
            },
          ],
        },
      ],
    };

    const json = translator.toCompactJson(tree, { precision: 2 });
    expect(typeof json).toBe("string");
    // Float values should be rounded to 2 decimals
    expect(json).toContain("[1.23,2.35,3.46]");

    const restored = translator.fromCompactJson(json);
    expect(restored.frameId).toBe(999n);
    expect(restored.entities).toHaveLength(1);
    expect(restored.entities[0].id).toBe(7);
    expect(restored.entities[0].name).toBe("Drone");
    expect(restored.entities[0].position.x).toBe(1.23);
    expect(restored.entities[0].children).toHaveLength(1);
    expect(restored.entities[0].children![0].id).toBe(8);
  });

  it("converts scene tree directly to standalone PhysicsFrameSoA", () => {
    const translator = new DataTranslationLayer();

    const tree: HierarchicalSceneTree = {
      frameId: 42n,
      timestampNs: 42000n,
      entities: [
        {
          id: 1,
          position: { x: 1, y: 2, z: 3 },
          velocity: { x: 4, y: 5, z: 6 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          children: [
            {
              id: 2,
              parentId: 1,
              position: { x: 7, y: 8, z: 9 },
              velocity: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
            },
          ],
        },
      ],
    };

    const frame = translator.hierarchyToPhysicsFrame(tree, {
      deltaTime: 0.033,
      mode: EngineMode.DEBUG,
    });

    expect(frame.frameId).toBe(42n);
    expect(frame.mode).toBe(EngineMode.DEBUG);
    expect(frame.entityIds.length).toBe(2);
    expect(frame.entityIds[0]).toBe(1);
    expect(frame.entityIds[1]).toBe(2);
    expect(frame.parentIds![1]).toBe(1);
  });
});

