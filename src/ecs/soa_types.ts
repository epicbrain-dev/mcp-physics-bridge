/**
 * Sentinel value indicating that an entity is a root node (no parent).
 * 0xFFFFFFFF (4294967295) is standard in ECS engines for null parent index.
 */
export const NO_PARENT = 0xFFFFFFFF;

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion4D {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Struct of Arrays (SoA) contiguous TypedArray buffer views.
 * Total memory per entity: 2 Uint32 (8B) + 14 Float32 (56B) = 64 bytes (exact CPU cache line size).
 */
export interface SoABuffers {
  capacity: number;
  count: number;
  entityIds: Uint32Array;
  parentIds: Uint32Array;
  posX: Float32Array;
  posY: Float32Array;
  posZ: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  velZ: Float32Array;
  rotX: Float32Array;
  rotY: Float32Array;
  rotZ: Float32Array;
  rotW: Float32Array;
  angVelX: Float32Array;
  angVelY: Float32Array;
  angVelZ: Float32Array;
  radii: Float32Array;
  masses: Float32Array;
}

export interface EntityPhysicsNode {
  id: number;
  parentId?: number;
  name?: string;
  position: Vector3D;
  velocity: Vector3D;
  rotation: Quaternion4D;
  angularVelocity?: Vector3D;
  radius?: number;
  mass?: number;
  children?: EntityPhysicsNode[];
}

export interface HierarchicalSceneTree {
  frameId: bigint;
  timestampNs: bigint;
  entities: EntityPhysicsNode[];
  coordinateSpace?: "world" | "local";
  metadata?: Record<string, unknown>;
}

export interface SoATranslationOptions {
  /**
   * If true, compute local transforms relative to parents when generating tree.
   * If false, all nodes retain world coordinates (default: false).
   */
  computeLocalTransforms?: boolean;
  /**
   * Optional map from entity ID to human-readable name for LLM clarity.
   */
  nameMap?: Map<number, string> | Record<number, string>;
  /**
   * Custom root parent ID sentinel. Defaults to NO_PARENT (0xFFFFFFFF).
   * Also treats 0 as root if entity 0 is not in entityIds.
   */
  rootParentId?: number;
}

export interface CompactJsonOptions {
  /**
   * Number of decimal places to round floating point values to (default: 3).
   * Significantly reduces LLM token footprint.
   */
  precision?: number;
  /**
   * Whether to include velocity vectors (default: true).
   */
  includeVelocities?: boolean;
  /**
   * Whether to include angular velocity vectors (default: false).
   */
  includeAngularVelocities?: boolean;
  /**
   * Whether to include rotation quaternions (default: true).
   */
  includeRotations?: boolean;
  /**
   * JSON indentation spaces. Defaults to 0 (compact single-line).
   */
  indent?: number;
}
