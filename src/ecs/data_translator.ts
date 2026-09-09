import {
  SoABuffers,
  HierarchicalSceneTree,
  EntityPhysicsNode,
  NO_PARENT,
  Vector3D,
  Quaternion4D,
  SoATranslationOptions,
  CompactJsonOptions,
} from "./soa_types.js";
import { PhysicsFrameSoA, EngineMode } from "../proto/index.js";
import { ECSView } from "./ecs_view.js";

// Helper 3D math functions for forward and inverse kinematics
function rotateVectorByQuat(v: Vector3D, q: Quaternion4D): Vector3D {
  // v' = v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const cx = qy * v.z - qz * v.y + qw * v.x;
  const cy = qz * v.x - qx * v.z + qw * v.y;
  const cz = qx * v.y - qy * v.x + qw * v.z;

  return {
    x: v.x + 2 * (qy * cz - qz * cy),
    y: v.y + 2 * (qz * cx - qx * cz),
    z: v.z + 2 * (qx * cy - qy * cx),
  };
}

function rotateVectorByQuatInverse(v: Vector3D, q: Quaternion4D): Vector3D {
  const invQ: Quaternion4D = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  return rotateVectorByQuat(v, invQ);
}

function multiplyQuaternions(a: Quaternion4D, b: Quaternion4D): Quaternion4D {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function invertQuaternion(q: Quaternion4D): Quaternion4D {
  const lenSq = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w || 1.0;
  return {
    x: -q.x / lenSq,
    y: -q.y / lenSq,
    z: -q.z / lenSq,
    w: q.w / lenSq,
  };
}

/**
 * DataTranslationLayer converts engine flat Struct of Arrays (SoA) into
 * hierarchical object trees optimized for LLM context digestion, and vice versa.
 */
export class DataTranslationLayer {
  /**
   * Translates a flat SoA frame or ECSView into a hierarchical scene tree representation.
   */
  public soaToHierarchy(
    source: PhysicsFrameSoA | ECSView | SoABuffers,
    options?: SoATranslationOptions
  ): HierarchicalSceneTree {
    let frameId = 0n;
    let timestampNs = 0n;
    let count = 0;
    let entityIds: Uint32Array | number[];
    let parentIds: Uint32Array | number[] | undefined;
    let posX: Float32Array | number[];
    let posY: Float32Array | number[];
    let posZ: Float32Array | number[];
    let velX: Float32Array | number[];
    let velY: Float32Array | number[];
    let velZ: Float32Array | number[];
    let rotX: Float32Array | number[];
    let rotY: Float32Array | number[];
    let rotZ: Float32Array | number[];
    let rotW: Float32Array | number[];
    let angVelX: Float32Array | number[] | undefined;
    let angVelY: Float32Array | number[] | undefined;
    let angVelZ: Float32Array | number[] | undefined;
    let radii: Float32Array | number[] | undefined;
    let masses: Float32Array | number[] | undefined;

    if (source instanceof ECSView) {
      const active = source.getActiveBuffers();
      count = active.count;
      entityIds = active.entityIds;
      parentIds = active.parentIds;
      posX = active.posX;
      posY = active.posY;
      posZ = active.posZ;
      velX = active.velX;
      velY = active.velY;
      velZ = active.velZ;
      rotX = active.rotX;
      rotY = active.rotY;
      rotZ = active.rotZ;
      rotW = active.rotW;
      angVelX = active.angVelX;
      angVelY = active.angVelY;
      angVelZ = active.angVelZ;
      radii = active.radii;
      masses = active.masses;
    } else if ("capacity" in source && "count" in source) {
      // SoABuffers
      count = source.count;
      entityIds = source.entityIds;
      parentIds = source.parentIds;
      posX = source.posX;
      posY = source.posY;
      posZ = source.posZ;
      velX = source.velX;
      velY = source.velY;
      velZ = source.velZ;
      rotX = source.rotX;
      rotY = source.rotY;
      rotZ = source.rotZ;
      rotW = source.rotW;
      angVelX = source.angVelX;
      angVelY = source.angVelY;
      angVelZ = source.angVelZ;
      radii = source.radii;
      masses = source.masses;
    } else {
      // PhysicsFrameSoA
      frameId = source.frameId;
      timestampNs = source.timestampNs;
      count = source.entityIds.length;
      entityIds = source.entityIds;
      parentIds = source.parentIds;
      posX = source.posX;
      posY = source.posY;
      posZ = source.posZ;
      velX = source.velX;
      velY = source.velY;
      velZ = source.velZ;
      rotX = source.rotX;
      rotY = source.rotY;
      rotZ = source.rotZ;
      rotW = source.rotW;
      angVelX = source.angVelX;
      angVelY = source.angVelY;
      angVelZ = source.angVelZ;
      radii = source.radii;
      masses = source.masses;
    }

    const nodeMap = new Map<number, EntityPhysicsNode>();
    const rootParentSentinel = options?.rootParentId ?? NO_PARENT;

    // First pass: instantiate all nodes in world space
    for (let i = 0; i < count; i++) {
      const id = entityIds[i];
      let parentId = parentIds ? parentIds[i] : undefined;
      if (parentId === rootParentSentinel || parentId === NO_PARENT) {
        parentId = undefined;
      }

      let name: string | undefined;
      if (options?.nameMap) {
        if (options.nameMap instanceof Map) {
          name = options.nameMap.get(id);
        } else {
          name = (options.nameMap as Record<number, string>)[id];
        }
      }

      const node: EntityPhysicsNode = {
        id,
        parentId,
        name,
        position: {
          x: posX[i],
          y: posY[i],
          z: posZ[i],
        },
        velocity: {
          x: velX[i],
          y: velY[i],
          z: velZ[i],
        },
        rotation: {
          x: rotX[i],
          y: rotY[i],
          z: rotZ[i],
          w: rotW[i],
        },
        angularVelocity: angVelX && angVelY && angVelZ ? {
          x: angVelX[i],
          y: angVelY[i],
          z: angVelZ[i],
        } : undefined,
        radius: radii ? radii[i] : undefined,
        mass: masses ? masses[i] : undefined,
      };

      nodeMap.set(id, node);
    }

    // Second pass: assemble hierarchy
    const rootNodes: EntityPhysicsNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.parentId !== undefined && nodeMap.has(node.parentId) && node.parentId !== node.id) {
        const parent = nodeMap.get(node.parentId)!;
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(node);
      } else {
        rootNodes.push(node);
      }
    }

    // Optional third pass: convert to local space if requested
    if (options?.computeLocalTransforms) {
      const convertToLocal = (node: EntityPhysicsNode, parent?: EntityPhysicsNode) => {
        if (parent) {
          // Local position = inv(parent.rot) * (node.worldPos - parent.worldPos)
          const deltaPos: Vector3D = {
            x: node.position.x - parent.position.x,
            y: node.position.y - parent.position.y,
            z: node.position.z - parent.position.z,
          };
          node.position = rotateVectorByQuatInverse(deltaPos, parent.rotation);

          // Local rotation = inv(parent.rot) * node.worldRot
          const invParentRot = invertQuaternion(parent.rotation);
          node.rotation = multiplyQuaternions(invParentRot, node.rotation);

          // Local velocity = inv(parent.rot) * (node.worldVel - parent.worldVel)
          const deltaVel: Vector3D = {
            x: node.velocity.x - parent.velocity.x,
            y: node.velocity.y - parent.velocity.y,
            z: node.velocity.z - parent.velocity.z,
          };
          node.velocity = rotateVectorByQuatInverse(deltaVel, parent.rotation);
        }

        if (node.children) {
          for (const child of node.children) {
            convertToLocal(child, node);
          }
        }
      };

      for (const root of rootNodes) {
        if (root.children) {
          for (const child of root.children) {
            convertToLocal(child, root);
          }
        }
      }
    }

    return {
      frameId,
      timestampNs,
      entities: rootNodes,
      coordinateSpace: options?.computeLocalTransforms ? "local" : "world",
    };
  }

  /**
   * Applies hierarchical scene changes back into contiguous SoA buffers or ECSView.
   */
  public hierarchyToSoA(
    tree: HierarchicalSceneTree,
    target: SoABuffers | ECSView,
    _options?: SoATranslationOptions
  ): void {
    const buffers = target instanceof ECSView ? target.buffers : target;
    let writeIndex = 0;
    const isLocal = tree.coordinateSpace === "local";

    const flattenNode = (
      node: EntityPhysicsNode,
      parentWorldPos?: Vector3D,
      parentWorldRot?: Quaternion4D,
      parentWorldVel?: Vector3D
    ) => {
      if (writeIndex >= buffers.capacity) return;

      const idx = writeIndex++;
      buffers.entityIds[idx] = node.id;
      buffers.parentIds[idx] = node.parentId ?? NO_PARENT;

      let worldPos = node.position;
      let worldRot = node.rotation;
      let worldVel = node.velocity;

      if (isLocal && parentWorldPos && parentWorldRot && parentWorldVel) {
        // Child world rot = parent.rot * child.localRot
        worldRot = multiplyQuaternions(parentWorldRot, node.rotation);
        // Child world pos = parent.pos + parent.rot * child.localPos
        const rotatedPos = rotateVectorByQuat(node.position, parentWorldRot);
        worldPos = {
          x: parentWorldPos.x + rotatedPos.x,
          y: parentWorldPos.y + rotatedPos.y,
          z: parentWorldPos.z + rotatedPos.z,
        };
        // Child world vel = parent.vel + parent.rot * child.localVel
        const rotatedVel = rotateVectorByQuat(node.velocity, parentWorldRot);
        worldVel = {
          x: parentWorldVel.x + rotatedVel.x,
          y: parentWorldVel.y + rotatedVel.y,
          z: parentWorldVel.z + rotatedVel.z,
        };
      }

      buffers.posX[idx] = worldPos.x;
      buffers.posY[idx] = worldPos.y;
      buffers.posZ[idx] = worldPos.z;

      buffers.velX[idx] = worldVel.x;
      buffers.velY[idx] = worldVel.y;
      buffers.velZ[idx] = worldVel.z;

      buffers.rotX[idx] = worldRot.x;
      buffers.rotY[idx] = worldRot.y;
      buffers.rotZ[idx] = worldRot.z;
      buffers.rotW[idx] = worldRot.w;

      if (node.angularVelocity) {
        buffers.angVelX[idx] = node.angularVelocity.x;
        buffers.angVelY[idx] = node.angularVelocity.y;
        buffers.angVelZ[idx] = node.angularVelocity.z;
      }

      if (node.radius !== undefined) {
        buffers.radii[idx] = node.radius;
      }
      if (node.mass !== undefined) {
        buffers.masses[idx] = node.mass;
      }

      if (node.children) {
        for (const child of node.children) {
          flattenNode(child, worldPos, worldRot, worldVel);
        }
      }
    };

    for (const root of tree.entities) {
      flattenNode(root);
    }

    buffers.count = writeIndex;
  }

  /**
   * Converts a HierarchicalSceneTree directly to a standalone PhysicsFrameSoA.
   */
  public hierarchyToPhysicsFrame(
    tree: HierarchicalSceneTree,
    options?: { deltaTime?: number; mode?: EngineMode }
  ): PhysicsFrameSoA {
    // Count all nodes in tree
    const countNodes = (node: EntityPhysicsNode): number => {
      let c = 1;
      if (node.children) {
        for (const ch of node.children) c += countNodes(ch);
      }
      return c;
    };

    let totalNodes = 0;
    for (const r of tree.entities) totalNodes += countNodes(r);

    const view = new ECSView(Math.max(totalNodes, 1));
    this.hierarchyToSoA(tree, view);

    return view.asPhysicsFrame(
      tree.frameId,
      tree.timestampNs,
      options?.deltaTime ?? 0.016667,
      options?.mode ?? EngineMode.PLAYTEST
    );
  }

  /**
   * Extracts a focused subtree rooted at rootEntityId for targeted AI reasoning.
   */
  public filterSubtree(tree: HierarchicalSceneTree, rootEntityId: number): HierarchicalSceneTree {
    let foundNode: EntityPhysicsNode | undefined;

    const search = (node: EntityPhysicsNode): boolean => {
      if (node.id === rootEntityId) {
        foundNode = node;
        return true;
      }
      if (node.children) {
        for (const child of node.children) {
          if (search(child)) return true;
        }
      }
      return false;
    };

    for (const root of tree.entities) {
      if (search(root)) break;
    }

    return {
      frameId: tree.frameId,
      timestampNs: tree.timestampNs,
      coordinateSpace: tree.coordinateSpace,
      entities: foundNode ? [foundNode] : [],
      metadata: tree.metadata,
    };
  }

  /**
   * Spatial Context Filtering: Keeps only entities within a radius from a center point.
   */
  public filterSpatialRadius(
    tree: HierarchicalSceneTree,
    center: Vector3D,
    radius: number
  ): HierarchicalSceneTree {
    const rSq = radius * radius;

    const filterNode = (node: EntityPhysicsNode): EntityPhysicsNode | null => {
      const dx = node.position.x - center.x;
      const dy = node.position.y - center.y;
      const dz = node.position.z - center.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const inRadius = distSq <= rSq;

      let filteredChildren: EntityPhysicsNode[] | undefined;
      if (node.children) {
        const kept = node.children
          .map((ch) => filterNode(ch))
          .filter((ch): ch is EntityPhysicsNode => ch !== null);
        if (kept.length > 0) filteredChildren = kept;
      }

      if (inRadius || (filteredChildren && filteredChildren.length > 0)) {
        return {
          ...node,
          children: filteredChildren,
        };
      }
      return null;
    };

    const filteredEntities = tree.entities
      .map((r) => filterNode(r))
      .filter((r): r is EntityPhysicsNode => r !== null);

    return {
      frameId: tree.frameId,
      timestampNs: tree.timestampNs,
      coordinateSpace: tree.coordinateSpace,
      entities: filteredEntities,
      metadata: tree.metadata,
    };
  }

  /**
   * Serializes a HierarchicalSceneTree into token-efficient JSON with rounded floats.
   */
  public toCompactJson(tree: HierarchicalSceneTree, options?: CompactJsonOptions): string {
    const precision = options?.precision ?? 3;
    const factor = Math.pow(10, precision);
    const round = (val: number): number => Math.round(val * factor) / factor;

    const pruneNode = (node: EntityPhysicsNode): any => {
      const obj: any = {
        id: node.id,
      };
      if (node.name) obj.name = node.name;
      if (node.parentId !== undefined) obj.parentId = node.parentId;

      obj.pos = [round(node.position.x), round(node.position.y), round(node.position.z)];

      if (options?.includeVelocities !== false) {
        obj.vel = [round(node.velocity.x), round(node.velocity.y), round(node.velocity.z)];
      }

      if (options?.includeRotations !== false) {
        obj.rot = [
          round(node.rotation.x),
          round(node.rotation.y),
          round(node.rotation.z),
          round(node.rotation.w),
        ];
      }

      if (options?.includeAngularVelocities && node.angularVelocity) {
        obj.angVel = [
          round(node.angularVelocity.x),
          round(node.angularVelocity.y),
          round(node.angularVelocity.z),
        ];
      }

      if (node.radius !== undefined) obj.radius = round(node.radius);
      if (node.mass !== undefined) obj.mass = round(node.mass);

      if (node.children && node.children.length > 0) {
        obj.children = node.children.map((ch) => pruneNode(ch));
      }

      return obj;
    };

    const serializable = {
      frameId: tree.frameId.toString(),
      timestampNs: tree.timestampNs.toString(),
      space: tree.coordinateSpace ?? "world",
      entities: tree.entities.map((e) => pruneNode(e)),
    };

    return JSON.stringify(serializable, null, options?.indent ?? 0);
  }

  /**
   * Deserializes compact JSON back into a HierarchicalSceneTree.
   */
  public fromCompactJson(jsonStr: string): HierarchicalSceneTree {
    const raw = JSON.parse(jsonStr);

    const restoreNode = (obj: any): EntityPhysicsNode => {
      const pos = obj.pos || [0, 0, 0];
      const vel = obj.vel || [0, 0, 0];
      const rot = obj.rot || [0, 0, 0, 1];

      const node: EntityPhysicsNode = {
        id: Number(obj.id),
        name: obj.name,
        parentId: obj.parentId !== undefined ? Number(obj.parentId) : undefined,
        position: { x: Number(pos[0]), y: Number(pos[1]), z: Number(pos[2]) },
        velocity: { x: Number(vel[0]), y: Number(vel[1]), z: Number(vel[2]) },
        rotation: {
          x: Number(rot[0]),
          y: Number(rot[1]),
          z: Number(rot[2]),
          w: Number(rot[3]),
        },
        radius: obj.radius !== undefined ? Number(obj.radius) : undefined,
        mass: obj.mass !== undefined ? Number(obj.mass) : undefined,
      };

      if (obj.angVel) {
        node.angularVelocity = {
          x: Number(obj.angVel[0]),
          y: Number(obj.angVel[1]),
          z: Number(obj.angVel[2]),
        };
      }

      if (Array.isArray(obj.children) && obj.children.length > 0) {
        node.children = obj.children.map((ch: any) => restoreNode(ch));
      }

      return node;
    };

    return {
      frameId: BigInt(raw.frameId ?? 0),
      timestampNs: BigInt(raw.timestampNs ?? 0),
      coordinateSpace: raw.space ?? "world",
      entities: Array.isArray(raw.entities) ? raw.entities.map((e: any) => restoreNode(e)) : [],
    };
  }
}

