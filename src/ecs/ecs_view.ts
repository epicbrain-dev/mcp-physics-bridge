import { SoABuffers, EntityPhysicsNode, NO_PARENT } from "./soa_types.js";
import { PhysicsFrameSoA, EngineMode } from "../proto/index.js";

/**
 * Total components per entity:
 * 2 Uint32 (entityIds, parentIds) = 8 bytes
 * 3 Float32 (pos) = 12 bytes
 * 3 Float32 (vel) = 12 bytes
 * 4 Float32 (rot) = 16 bytes
 * 3 Float32 (angVel) = 12 bytes
 * 1 Float32 (radius) = 4 bytes
 * 1 Float32 (mass) = 4 bytes
 * Total: 17 * 4 = 68 bytes per entity.
 */
export const BYTES_PER_ENTITY = 68;

/**
 * ECSView manages contiguous ArrayBuffer allocations for 60 FPS Struct of Arrays (SoA).
 * Eliminates garbage collection thrashing and supports zero-copy subarray views.
 */
export class ECSView {
  private readonly buffer: ArrayBuffer;
  private readonly baseByteOffset: number;
  public readonly buffers: SoABuffers;
  private readonly idToIndexMap: Map<number, number> = new Map();

  constructor(
    public readonly capacity: number = 1024,
    existingBuffer?: ArrayBuffer,
    byteOffset: number = 0
  ) {
    const requiredBytes = capacity * BYTES_PER_ENTITY;
    this.baseByteOffset = byteOffset;

    if (existingBuffer) {
      if (existingBuffer.byteLength < byteOffset + requiredBytes) {
        throw new Error(
          `Buffer too small: requires ${byteOffset + requiredBytes} bytes, provided ${existingBuffer.byteLength}`
        );
      }
      this.buffer = existingBuffer;
    } else {
      this.buffer = new ArrayBuffer(requiredBytes);
    }

    let offset = this.baseByteOffset;
    const entityIds = new Uint32Array(this.buffer, offset, capacity);
    offset += capacity * 4;

    const parentIds = new Uint32Array(this.buffer, offset, capacity);
    offset += capacity * 4;

    const posX = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;
    const posY = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;
    const posZ = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;

    const velX = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;
    const velY = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;
    const velZ = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;

    const rotX = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;
    const rotY = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;
    const rotZ = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;
    const rotW = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;

    const angVelX = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;
    const angVelY = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;
    const angVelZ = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;

    const radii = new Float32Array(this.buffer, offset, capacity);
    offset += capacity * 4;

    const masses = new Float32Array(this.buffer, offset, capacity);

    if (!existingBuffer) {
      parentIds.fill(NO_PARENT);
      rotW.fill(1.0);
      radii.fill(1.0);
      masses.fill(1.0);
    }

    this.buffers = {
      capacity,
      count: 0,
      entityIds,
      parentIds,
      posX,
      posY,
      posZ,
      velX,
      velY,
      velZ,
      rotX,
      rotY,
      rotZ,
      rotW,
      angVelX,
      angVelY,
      angVelZ,
      radii,
      masses,
    };
  }

  /**
   * Factory: creates ECSView by wrapping an existing ArrayBuffer zero-copy.
   */
  public static fromBuffer(
    buffer: ArrayBuffer,
    capacity?: number,
    byteOffset: number = 0
  ): ECSView {
    const computedCapacity = capacity ?? Math.floor((buffer.byteLength - byteOffset) / BYTES_PER_ENTITY);
    return new ECSView(computedCapacity, buffer, byteOffset);
  }

  /**
   * Factory: populates a new ECSView from a typed PhysicsFrameSoA.
   */
  public static fromPhysicsFrame(frame: PhysicsFrameSoA, initialCapacity?: number): ECSView {
    const entityCount = frame.entityIds.length;
    const capacity = Math.max(initialCapacity ?? entityCount, entityCount, 1);
    const view = new ECSView(capacity);

    const b = view.buffers;
    const fIds = frame.entityIds;
    const fParents = frame.parentIds;
    const fPosX = frame.posX;
    const fPosY = frame.posY;
    const fPosZ = frame.posZ;
    const fVelX = frame.velX;
    const fVelY = frame.velY;
    const fVelZ = frame.velZ;
    const fRotX = frame.rotX;
    const fRotY = frame.rotY;
    const fRotZ = frame.rotZ;
    const fRotW = frame.rotW;
    const fAngX = frame.angVelX;
    const fAngY = frame.angVelY;
    const fAngZ = frame.angVelZ;
    const fRadii = frame.radii;
    const fMasses = frame.masses;

    for (let i = 0; i < entityCount; i++) {
      b.entityIds[i] = fIds[i];
      b.parentIds[i] = fParents ? fParents[i] : NO_PARENT;
      b.posX[i] = fPosX[i];
      b.posY[i] = fPosY[i];
      b.posZ[i] = fPosZ[i];
      b.velX[i] = fVelX[i];
      b.velY[i] = fVelY[i];
      b.velZ[i] = fVelZ[i];
      b.rotX[i] = fRotX[i];
      b.rotY[i] = fRotY[i];
      b.rotZ[i] = fRotZ[i];
      b.rotW[i] = fRotW[i];
      b.angVelX[i] = fAngX ? fAngX[i] : 0;
      b.angVelY[i] = fAngY ? fAngY[i] : 0;
      b.angVelZ[i] = fAngZ ? fAngZ[i] : 0;
      b.radii[i] = fRadii ? fRadii[i] : 1.0;
      b.masses[i] = fMasses ? fMasses[i] : 1.0;

      view.idToIndexMap.set(b.entityIds[i], i);
    }

    b.count = entityCount;
    return view;
  }

  /**
   * Returns zero-copy subarray views representing active entities without allocations.
   */
  public getActiveBuffers(): SoABuffers {
    const count = this.buffers.count;
    return {
      capacity: this.buffers.capacity,
      count,
      entityIds: this.buffers.entityIds.subarray(0, count),
      parentIds: this.buffers.parentIds.subarray(0, count),
      posX: this.buffers.posX.subarray(0, count),
      posY: this.buffers.posY.subarray(0, count),
      posZ: this.buffers.posZ.subarray(0, count),
      velX: this.buffers.velX.subarray(0, count),
      velY: this.buffers.velY.subarray(0, count),
      velZ: this.buffers.velZ.subarray(0, count),
      rotX: this.buffers.rotX.subarray(0, count),
      rotY: this.buffers.rotY.subarray(0, count),
      rotZ: this.buffers.rotZ.subarray(0, count),
      rotW: this.buffers.rotW.subarray(0, count),
      angVelX: this.buffers.angVelX.subarray(0, count),
      angVelY: this.buffers.angVelY.subarray(0, count),
      angVelZ: this.buffers.angVelZ.subarray(0, count),
      radii: this.buffers.radii.subarray(0, count),
      masses: this.buffers.masses.subarray(0, count),
    };
  }

  /**
   * Returns a zero-copy PhysicsFrameSoA representation backed by this ECSView's buffers.
   */
  public asPhysicsFrame(
    frameId: bigint,
    timestampNs: bigint,
    deltaTime: number = 0.016667,
    mode: EngineMode = EngineMode.PLAYTEST
  ): PhysicsFrameSoA {
    const active = this.getActiveBuffers();
    return {
      frameId,
      timestampNs,
      deltaTime,
      mode,
      entityIds: active.entityIds,
      parentIds: active.parentIds,
      posX: active.posX,
      posY: active.posY,
      posZ: active.posZ,
      velX: active.velX,
      velY: active.velY,
      velZ: active.velZ,
      rotX: active.rotX,
      rotY: active.rotY,
      rotZ: active.rotZ,
      rotW: active.rotW,
      angVelX: active.angVelX,
      angVelY: active.angVelY,
      angVelZ: active.angVelZ,
      radii: active.radii,
      masses: active.masses,
    };
  }

  /**
   * Adds an entity node to the contiguous SoA buffers.
   * Returns the entity index.
   */
  public addEntity(node: Partial<EntityPhysicsNode> & { id: number }): number {
    if (this.buffers.count >= this.capacity) {
      throw new Error(`ECSView capacity reached (${this.capacity})`);
    }

    const index = this.buffers.count++;
    this.buffers.parentIds[index] = node.parentId ?? NO_PARENT;
    this.setEntity(index, node);
    this.idToIndexMap.set(node.id, index);
    return index;
  }

  /**
   * Sets entity component values at a specific index.
   */
  public setEntity(index: number, node: Partial<EntityPhysicsNode> & { id?: number }): void {
    if (index < 0 || index >= this.capacity) {
      throw new Error(`Index ${index} out of bounds (capacity ${this.capacity})`);
    }

    const b = this.buffers;
    if (node.id !== undefined) {
      const oldId = b.entityIds[index];
      if (oldId !== undefined && oldId !== node.id) {
        this.idToIndexMap.delete(oldId);
      }
      b.entityIds[index] = node.id;
      this.idToIndexMap.set(node.id, index);
    }

    if (node.parentId !== undefined) {
      b.parentIds[index] = node.parentId;
    }

    if (node.position) {
      b.posX[index] = node.position.x;
      b.posY[index] = node.position.y;
      b.posZ[index] = node.position.z;
    }

    if (node.velocity) {
      b.velX[index] = node.velocity.x;
      b.velY[index] = node.velocity.y;
      b.velZ[index] = node.velocity.z;
    }

    if (node.rotation) {
      b.rotX[index] = node.rotation.x;
      b.rotY[index] = node.rotation.y;
      b.rotZ[index] = node.rotation.z;
      b.rotW[index] = node.rotation.w;
    }

    if (node.angularVelocity) {
      b.angVelX[index] = node.angularVelocity.x;
      b.angVelY[index] = node.angularVelocity.y;
      b.angVelZ[index] = node.angularVelocity.z;
    }

    if (node.radius !== undefined) {
      b.radii[index] = node.radius;
    }

    if (node.mass !== undefined) {
      b.masses[index] = node.mass;
    }
  }

  /**
   * Retrieves an EntityPhysicsNode representation from a buffer index.
   */
  public getEntity(index: number): EntityPhysicsNode {
    if (index < 0 || index >= this.buffers.count) {
      throw new Error(`Index ${index} out of range (count ${this.buffers.count})`);
    }

    const b = this.buffers;
    return {
      id: b.entityIds[index],
      parentId: b.parentIds[index] === NO_PARENT ? undefined : b.parentIds[index],
      position: { x: b.posX[index], y: b.posY[index], z: b.posZ[index] },
      velocity: { x: b.velX[index], y: b.velY[index], z: b.velZ[index] },
      rotation: { x: b.rotX[index], y: b.rotY[index], z: b.rotZ[index], w: b.rotW[index] },
      angularVelocity: { x: b.angVelX[index], y: b.angVelY[index], z: b.angVelZ[index] },
      radius: b.radii[index],
      mass: b.masses[index],
    };
  }

  /**
   * Finds the array index for a given entity ID in O(1).
   */
  public findEntityIndex(entityId: number): number {
    const cached = this.idToIndexMap.get(entityId);
    if (cached !== undefined && cached < this.buffers.count && this.buffers.entityIds[cached] === entityId) {
      return cached;
    }

    // Fallback scan
    for (let i = 0; i < this.buffers.count; i++) {
      if (this.buffers.entityIds[i] === entityId) {
        this.idToIndexMap.set(entityId, i);
        return i;
      }
    }
    return -1;
  }

  /**
   * Removes an entity by ID in O(1) using swap-and-pop with the last active entity.
   */
  public removeEntity(entityId: number): boolean {
    const index = this.findEntityIndex(entityId);
    if (index === -1) return false;

    const lastIndex = this.buffers.count - 1;
    if (index !== lastIndex) {
      // Swap last entity into this index
      const b = this.buffers;
      b.entityIds[index] = b.entityIds[lastIndex];
      b.parentIds[index] = b.parentIds[lastIndex];
      b.posX[index] = b.posX[lastIndex];
      b.posY[index] = b.posY[lastIndex];
      b.posZ[index] = b.posZ[lastIndex];
      b.velX[index] = b.velX[lastIndex];
      b.velY[index] = b.velY[lastIndex];
      b.velZ[index] = b.velZ[lastIndex];
      b.rotX[index] = b.rotX[lastIndex];
      b.rotY[index] = b.rotY[lastIndex];
      b.rotZ[index] = b.rotZ[lastIndex];
      b.rotW[index] = b.rotW[lastIndex];
      b.angVelX[index] = b.angVelX[lastIndex];
      b.angVelY[index] = b.angVelY[lastIndex];
      b.angVelZ[index] = b.angVelZ[lastIndex];
      b.radii[index] = b.radii[lastIndex];
      b.masses[index] = b.masses[lastIndex];

      this.idToIndexMap.set(b.entityIds[index], index);
    }

    this.idToIndexMap.delete(entityId);
    this.buffers.count--;
    return true;
  }

  /**
   * Resets active count to 0 without reallocating underlying ArrayBuffer.
   */
  public reset(): void {
    this.buffers.count = 0;
    this.idToIndexMap.clear();
  }

  /**
   * Copies active contents from another ECSView.
   */
  public copyFrom(source: ECSView): void {
    const count = Math.min(source.buffers.count, this.capacity);
    const sb = source.buffers;
    const db = this.buffers;

    db.entityIds.set(sb.entityIds.subarray(0, count));
    db.parentIds.set(sb.parentIds.subarray(0, count));
    db.posX.set(sb.posX.subarray(0, count));
    db.posY.set(sb.posY.subarray(0, count));
    db.posZ.set(sb.posZ.subarray(0, count));
    db.velX.set(sb.velX.subarray(0, count));
    db.velY.set(sb.velY.subarray(0, count));
    db.velZ.set(sb.velZ.subarray(0, count));
    db.rotX.set(sb.rotX.subarray(0, count));
    db.rotY.set(sb.rotY.subarray(0, count));
    db.rotZ.set(sb.rotZ.subarray(0, count));
    db.rotW.set(sb.rotW.subarray(0, count));
    db.angVelX.set(sb.angVelX.subarray(0, count));
    db.angVelY.set(sb.angVelY.subarray(0, count));
    db.angVelZ.set(sb.angVelZ.subarray(0, count));
    db.radii.set(sb.radii.subarray(0, count));
    db.masses.set(sb.masses.subarray(0, count));

    db.count = count;
    this.idToIndexMap.clear();
    for (let i = 0; i < count; i++) {
      this.idToIndexMap.set(db.entityIds[i], i);
    }
  }

  /**
   * Returns underlying ArrayBuffer.
   */
  public getRawBuffer(): ArrayBuffer {
    return this.buffer;
  }

  /**
   * Returns byte size of the active entities buffer.
   */
  public getByteLength(): number {
    return this.buffers.count * BYTES_PER_ENTITY;
  }
}

