import {
  PhysicsFrameSoA,
  PhysicsStatusCode,
  PhysicsValidationResponse,
  PhysicsErrorBitmask,
  addPhysicsError,
} from "../proto/index.js";

export interface DebugModeConstraints {
  /**
   * Maximum linear velocity magnitude before strict rejection.
   * Default: 50.0 units/sec.
   */
  maxLinearVelocity: number;
  /**
   * Maximum angular velocity magnitude before strict rejection.
   * Default: 25.0 rad/s.
   */
  maxAngularVelocity: number;
  /**
   * Maximum world coordinates before out-of-bounds rejection.
   * Default: 10000.0 units.
   */
  worldBounds: number;
  /**
   * Quaternion normalization tolerance (|norm^2 - 1.0| <= tolerance).
   * Default: 0.05.
   */
  quaternionTolerance: number;
  /**
   * Intersphere collision tolerance in units. Overlap > tolerance triggers strict rejection.
   * Default: 0.001 units.
   */
  collisionTolerance: number;
  /**
   * Whether to enforce deterministic frame ID and timestamp monotonicity (lockstep).
   * Default: false.
   */
  enforceDeterministicLockstep: boolean;
}

export const defaultDebugConstraints: DebugModeConstraints = {
  maxLinearVelocity: 50.0,
  maxAngularVelocity: 25.0,
  worldBounds: 10000.0,
  quaternionTolerance: 0.05,
  collisionTolerance: 0.001,
  enforceDeterministicLockstep: false,
};

/**
 * DebugModeValidator disables safety nets and strictly rejects invalid physics frames,
 * appending error status bitmasks directly to the exact failing frame for developer debugging.
 *
 * Exposes raw physics failures and enforces deterministic lockstep validation.
 */
export class DebugModeValidator {
  private lastFrameId: bigint = 0n;
  private lastTimestampNs: bigint = 0n;

  constructor(private constraints: DebugModeConstraints = { ...defaultDebugConstraints }) {}

  /**
   * Updates runtime debug constraints.
   */
  public setConstraints(newConstraints: Partial<DebugModeConstraints>): void {
    this.constraints = { ...this.constraints, ...newConstraints };
  }

  /**
   * Gets current debug constraints.
   */
  public getConstraints(): DebugModeConstraints {
    return { ...this.constraints };
  }

  /**
   * Resets stored lockstep sequence tracking.
   */
  public reset(): void {
    this.lastFrameId = 0n;
    this.lastTimestampNs = 0n;
  }

  /**
   * Strictly validates incoming physics frame against deterministic constraints.
   * Returns a PhysicsValidationResponse without any correctedFrame (safety nets disabled).
   */
  public validateStrict(frame: PhysicsFrameSoA): PhysicsValidationResponse {
    const failingEntityIds: number[] = [];
    const entityErrorBitmasks: number[] = [];
    let frameErrorBitmask: number = PhysicsErrorBitmask.ERROR_NONE;

    let detectedNaN = false;
    let detectedOOB = false;
    let detectedVelExceeded = false;
    let detectedAngVelExceeded = false;
    let detectedUnnormalized = false;
    let detectedCollision = false;
    let lockstepViolation = false;
    let lockstepErrorMsg = "";

    // 1. Deterministic Lockstep Verification
    if (this.constraints.enforceDeterministicLockstep && this.lastFrameId > 0n) {
      if (frame.frameId <= this.lastFrameId) {
        lockstepViolation = true;
        lockstepErrorMsg = `Deterministic lockstep violation: frameId ${frame.frameId} arrived out of sequence (last: ${this.lastFrameId})`;
        frameErrorBitmask = addPhysicsError(frameErrorBitmask, PhysicsErrorBitmask.ERROR_STRICT_REJECTED);
      } else if (frame.timestampNs < this.lastTimestampNs) {
        lockstepViolation = true;
        lockstepErrorMsg = `Deterministic lockstep violation: timestamp ${frame.timestampNs}ns decreased from ${this.lastTimestampNs}ns`;
        frameErrorBitmask = addPhysicsError(frameErrorBitmask, PhysicsErrorBitmask.ERROR_STRICT_REJECTED);
      }
    }

    const count = frame.entityIds.length;
    const hasAngVel = Boolean(
      frame.angVelX && frame.angVelX.length >= count &&
      frame.angVelY && frame.angVelY.length >= count &&
      frame.angVelZ && frame.angVelZ.length >= count
    );
    const hasRadii = Boolean(frame.radii && frame.radii.length >= count);
    const perEntityMasks: number[] = new Array(count).fill(PhysicsErrorBitmask.ERROR_NONE);

    // 2. Individual Entity Deterministic Checks
    for (let i = 0; i < count; i++) {
      let entityMask: number = PhysicsErrorBitmask.ERROR_NONE;
      const px = Number(frame.posX[i]);
      const py = Number(frame.posY[i]);
      const pz = Number(frame.posZ[i]);
      const vx = Number(frame.velX[i]);
      const vy = Number(frame.velY[i]);
      const vz = Number(frame.velZ[i]);
      const rx = Number(frame.rotX[i]);
      const ry = Number(frame.rotY[i]);
      const rz = Number(frame.rotZ[i]);
      const rw = Number(frame.rotW[i]);
      const ax = hasAngVel ? Number(frame.angVelX![i]) : 0;
      const ay = hasAngVel ? Number(frame.angVelY![i]) : 0;
      const az = hasAngVel ? Number(frame.angVelZ![i]) : 0;

      // Check for NaN or Infinity
      if (
        !Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz) ||
        !Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz) ||
        !Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rz) || !Number.isFinite(rw) ||
        (hasAngVel && (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)))
      ) {
        detectedNaN = true;
        entityMask = addPhysicsError(entityMask, PhysicsErrorBitmask.ERROR_NAN_OR_INF);
      }

      // Check for extreme Out-of-Bounds position
      const bounds = this.constraints.worldBounds;
      const maxCoord = Math.max(Math.abs(px), Math.abs(py), Math.abs(pz));
      if (maxCoord > bounds) {
        detectedOOB = true;
        entityMask = addPhysicsError(entityMask, PhysicsErrorBitmask.ERROR_OUT_OF_BOUNDS);
      }

      // Check linear velocity limit
      if (Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz)) {
        const speedSq = vx * vx + vy * vy + vz * vz;
        const maxSpeed = this.constraints.maxLinearVelocity;
        if (speedSq > maxSpeed * maxSpeed) {
          detectedVelExceeded = true;
          entityMask = addPhysicsError(entityMask, PhysicsErrorBitmask.ERROR_LINEAR_VEL_EXCEEDED);
        }
      }

      // Check angular velocity limit
      if (hasAngVel && Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az)) {
        const angSpeedSq = ax * ax + ay * ay + az * az;
        const maxAngSpeed = this.constraints.maxAngularVelocity;
        if (angSpeedSq > maxAngSpeed * maxAngSpeed) {
          detectedAngVelExceeded = true;
          entityMask = addPhysicsError(entityMask, PhysicsErrorBitmask.ERROR_ANGULAR_VEL_EXCEEDED);
        }
      }

      // Check quaternion normalization if finite
      if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
        const quatNormSq = rx * rx + ry * ry + rz * rz + rw * rw;
        if (Math.abs(quatNormSq - 1.0) > this.constraints.quaternionTolerance) {
          detectedUnnormalized = true;
          entityMask = addPhysicsError(entityMask, PhysicsErrorBitmask.ERROR_ROTATION_UNNORMALIZED);
        }
      }

      perEntityMasks[i] = entityMask;
    }

    // 3. Collision Penetration Checks between entities (only if radii are explicitly defined)
    if (hasRadii) {
      for (let i = 0; i < count; i++) {
        const rI = Number(frame.radii![i]);
        const pXI = Number(frame.posX[i]);
        const pYI = Number(frame.posY[i]);
        const pZI = Number(frame.posZ[i]);

        if (!Number.isFinite(pXI) || !Number.isFinite(pYI) || !Number.isFinite(pZI)) continue;

        for (let j = i + 1; j < count; j++) {
          const rJ = Number(frame.radii![j]);
          const pXJ = Number(frame.posX[j]);
          const pYJ = Number(frame.posY[j]);
          const pZJ = Number(frame.posZ[j]);

          if (!Number.isFinite(pXJ) || !Number.isFinite(pYJ) || !Number.isFinite(pZJ)) continue;

          const dx = pXI - pXJ;
          const dy = pYI - pYJ;
          const dz = pZI - pZJ;
          const distSq = dx * dx + dy * dy + dz * dz;
          const minDist = rI + rJ - this.constraints.collisionTolerance;

          if (distSq < minDist * minDist) {
            detectedCollision = true;
            perEntityMasks[i] = addPhysicsError(perEntityMasks[i], PhysicsErrorBitmask.ERROR_COLLISION_PENETRATION);
            perEntityMasks[j] = addPhysicsError(perEntityMasks[j], PhysicsErrorBitmask.ERROR_COLLISION_PENETRATION);
          }
        }
      }
    }

    // 4. Compile failing entities and align entity error bitmasks
    for (let i = 0; i < count; i++) {
      let mask = perEntityMasks[i];
      if (mask !== PhysicsErrorBitmask.ERROR_NONE) {
        mask = addPhysicsError(mask, PhysicsErrorBitmask.ERROR_STRICT_REJECTED);
        failingEntityIds.push(frame.entityIds[i]);
        entityErrorBitmasks.push(mask);
        frameErrorBitmask = addPhysicsError(frameErrorBitmask, mask);
      }
    }

    // Update lockstep tracker if valid frame or lockstep enabled
    if (!lockstepViolation) {
      this.lastFrameId = frame.frameId;
      this.lastTimestampNs = frame.timestampNs;
    }

    // 5. Build strict rejection response
    const hasFailures = detectedNaN || failingEntityIds.length > 0 || lockstepViolation;

    if (hasFailures) {
      let statusCode: PhysicsStatusCode;
      if (detectedNaN) {
        statusCode = PhysicsStatusCode.STATUS_NAN_DETECTED;
      } else if (
        detectedOOB &&
        !detectedVelExceeded &&
        !detectedAngVelExceeded &&
        !detectedUnnormalized &&
        !detectedCollision &&
        !lockstepViolation
      ) {
        statusCode = PhysicsStatusCode.STATUS_OOB_DETECTED;
      } else {
        statusCode = PhysicsStatusCode.STATUS_HARD_REJECTED;
      }

      const reasonMsg = lockstepViolation
        ? lockstepErrorMsg
        : `Strict rejection: ${failingEntityIds.length} entities violated deterministic constraints`;

      return {
        frameId: frame.frameId,
        statusCode,
        errorMessage: reasonMsg,
        failingEntityIds,
        frameErrorBitmask,
        entityErrorBitmasks,
      };
    }

    return {
      frameId: frame.frameId,
      statusCode: PhysicsStatusCode.STATUS_OK,
      frameErrorBitmask: PhysicsErrorBitmask.ERROR_NONE,
    };
  }
}

