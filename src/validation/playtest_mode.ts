import {
  PhysicsFrameSoA,
  PhysicsStatusCode,
  PhysicsValidationResponse,
  PhysicsErrorBitmask,
  addPhysicsError,
} from "../proto/index.js";

export interface PlaytestConstraints {
  /**
   * Maximum linear velocity magnitude before soft clamping is triggered.
   * Default: 50.0 units/sec.
   */
  maxLinearVelocity: number;
  /**
   * Maximum angular velocity magnitude (rad/s) before soft clamping is triggered.
   * Default: 25.0 rad/s.
   */
  maxAngularVelocity: number;
  /**
   * Maximum coordinate magnitude from origin before boundary clamping is triggered.
   * Default: 10000.0 units.
   */
  worldBounds: number;
  /**
   * Base collision distance threshold (penetration depth in units).
   * Default: 2.0 units.
   */
  collisionThreshold: number;
  /**
   * Position desynchronization threshold relative to predicted trajectory that triggers a VFX snap.
   * Default: 5.0 units.
   */
  snapDivergenceThreshold: number;
  /**
   * Position desynchronization threshold that triggers micro time-dilation trajectory smoothing.
   * Default: 0.5 units.
   */
  minorDivergenceThreshold: number;
  /**
   * Multiplier applied to deltaTime during micro time-dilation (e.g. 0.85 = 15% slow-down).
   * Default: 0.85.
   */
  microDilationFactor: number;
  /**
   * Separation impulse coefficient for soft collision resolution (0.0 = contact tangent, 1.0 = elastic).
   * Default: 0.0.
   */
  collisionRestitution: number;
  /**
   * Whether to evaluate trajectory prediction desynchronization between frames.
   * Default: false.
   */
  enableTrajectoryTracking?: boolean;
}

export const defaultPlaytestConstraints: PlaytestConstraints = {
  maxLinearVelocity: 50.0,
  maxAngularVelocity: 25.0,
  worldBounds: 10000.0,
  collisionThreshold: 2.0,
  snapDivergenceThreshold: 5.0,
  minorDivergenceThreshold: 0.5,
  microDilationFactor: 0.85,
  collisionRestitution: 0.0,
  enableTrajectoryTracking: false,
};

interface EntityPreviousState {
  posX: number;
  posY: number;
  posZ: number;
  velX: number;
  velY: number;
  velZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  rotW: number;
  frameId: bigint;
  timestampNs: bigint;
}

/**
 * PlaytestModeValidator applies soft clamping, micro time-dilation, and VFX-masked snaps
 * to smooth over AI glitches while keeping the game feeling responsive and unbroken.
 *
 * Emits a correctedFrame (PhysicsFrameSoA) whenever physics corrections are applied.
 */
export class PlaytestModeValidator {
  private readonly entityHistory: Map<number, EntityPreviousState> = new Map();

  constructor(private constraints: PlaytestConstraints = { ...defaultPlaytestConstraints }) {}

  /**
   * Updates runtime playtest constraints.
   */
  public setConstraints(newConstraints: Partial<PlaytestConstraints>): void {
    this.constraints = { ...this.constraints, ...newConstraints };
  }

  /**
   * Gets current playtest constraints.
   */
  public getConstraints(): PlaytestConstraints {
    return { ...this.constraints };
  }

  /**
   * Resets stored entity history (e.g., on level restart or scene reload).
   */
  public reset(): void {
    this.entityHistory.clear();
  }

  /**
   * Validates the incoming physics frame, applying soft clamping, micro time-dilation,
   * and VFX snaps as necessary. Returns a PhysicsValidationResponse containing the corrected frame.
   */
  public validateAndSmooth(frame: PhysicsFrameSoA): PhysicsValidationResponse {
    let clamped = false;
    let timeDilated = false;
    let vfxSnap = false;
    let frameErrorBitmask: number = PhysicsErrorBitmask.ERROR_NONE;

    const count = frame.entityIds.length;
    const failingEntityIds: number[] = [];
    const entityErrorBitmasks: number[] = [];

    // Check if optional arrays are provided with enough elements for all entities
    const hasAngVel = Boolean(
      frame.angVelX && frame.angVelX.length >= count &&
      frame.angVelY && frame.angVelY.length >= count &&
      frame.angVelZ && frame.angVelZ.length >= count
    );
    const hasRadii = Boolean(frame.radii && frame.radii.length >= count);
    const hasMasses = Boolean(frame.masses && frame.masses.length >= count);

    // Working copies for corrected frame generation
    const cPosX = new Float32Array(count);
    const cPosY = new Float32Array(count);
    const cPosZ = new Float32Array(count);
    const cVelX = new Float32Array(count);
    const cVelY = new Float32Array(count);
    const cVelZ = new Float32Array(count);
    const cRotX = new Float32Array(count);
    const cRotY = new Float32Array(count);
    const cRotZ = new Float32Array(count);
    const cRotW = new Float32Array(count);
    const cAngX = hasAngVel ? new Float32Array(count) : undefined;
    const cAngY = hasAngVel ? new Float32Array(count) : undefined;
    const cAngZ = hasAngVel ? new Float32Array(count) : undefined;
    let correctedDeltaTime = frame.deltaTime;

    // Per-entity error mask accumulator
    const perEntityMasks: number[] = new Array(count).fill(PhysicsErrorBitmask.ERROR_NONE);

    // Pass 1: Individual entity validation (NaN, bounds, velocity limits, quaternion normalization, trajectory desync)
    for (let i = 0; i < count; i++) {
      const entityId = frame.entityIds[i];
      let entityMask: number = PhysicsErrorBitmask.ERROR_NONE;

      let px = Number(frame.posX[i]);
      let py = Number(frame.posY[i]);
      let pz = Number(frame.posZ[i]);
      let vx = Number(frame.velX[i]);
      let vy = Number(frame.velY[i]);
      let vz = Number(frame.velZ[i]);
      let rx = Number(frame.rotX[i]);
      let ry = Number(frame.rotY[i]);
      let rz = Number(frame.rotZ[i]);
      let rw = Number(frame.rotW[i]);
      let ax = hasAngVel ? Number(frame.angVelX![i]) : 0;
      let ay = hasAngVel ? Number(frame.angVelY![i]) : 0;
      let az = hasAngVel ? Number(frame.angVelZ![i]) : 0;

      // 1. Check for NaN / Infinity
      const hasNaN =
        !Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz) ||
        !Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz) ||
        !Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rz) || !Number.isFinite(rw) ||
        (hasAngVel && (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)));

      if (hasNaN) {
        clamped = true;
        entityMask = addPhysicsError(entityMask, PhysicsErrorBitmask.ERROR_NAN_OR_INF);

        const prev = this.entityHistory.get(entityId);
        if (prev) {
          px = prev.posX;
          py = prev.posY;
          pz = prev.posZ;
          vx = 0;
          vy = 0;
          vz = 0;
          rx = prev.rotX;
          ry = prev.rotY;
          rz = prev.rotZ;
          rw = prev.rotW;
        } else {
          px = Number.isFinite(px) ? px : 0;
          py = Number.isFinite(py) ? py : 0;
          pz = Number.isFinite(pz) ? pz : 0;
          vx = 0;
          vy = 0;
          vz = 0;
          rx = 0;
          ry = 0;
          rz = 0;
          rw = 1.0;
        }
        ax = 0;
        ay = 0;
        az = 0;
      }

      // 2. World bounds soft clamping
      const bounds = this.constraints.worldBounds;
      if (Math.abs(px) > bounds || Math.abs(py) > bounds || Math.abs(pz) > bounds) {
        clamped = true;
        entityMask = addPhysicsError(entityMask, PhysicsErrorBitmask.ERROR_OUT_OF_BOUNDS);
        px = Math.max(-bounds, Math.min(bounds, px));
        py = Math.max(-bounds, Math.min(bounds, py));
        pz = Math.max(-bounds, Math.min(bounds, pz));
      }

      // 3. Linear velocity soft clamping (rescale vector magnitude to maxLinearVelocity)
      const speedSq = vx * vx + vy * vy + vz * vz;
      const maxSpeed = this.constraints.maxLinearVelocity;
      if (speedSq > maxSpeed * maxSpeed) {
        clamped = true;
        entityMask = addPhysicsError(entityMask, PhysicsErrorBitmask.ERROR_LINEAR_VEL_EXCEEDED);
        const speed = Math.sqrt(speedSq);
        if (speed > 1e-6) {
          const scale = maxSpeed / speed;
          vx *= scale;
          vy *= scale;
          vz *= scale;
        }
      }

      // 4. Angular velocity soft clamping (rescale angular velocity magnitude to maxAngularVelocity)
      if (hasAngVel) {
        const angSpeedSq = ax * ax + ay * ay + az * az;
        const maxAngSpeed = this.constraints.maxAngularVelocity;
        if (angSpeedSq > maxAngSpeed * maxAngSpeed) {
          clamped = true;
          entityMask = addPhysicsError(entityMask, PhysicsErrorBitmask.ERROR_ANGULAR_VEL_EXCEEDED);
          const angSpeed = Math.sqrt(angSpeedSq);
          if (angSpeed > 1e-6) {
            const scale = maxAngSpeed / angSpeed;
            ax *= scale;
            ay *= scale;
            az *= scale;
          }
        }
      }

      // 5. Quaternion normalization
      const quatNormSq = rx * rx + ry * ry + rz * rz + rw * rw;
      if (Math.abs(quatNormSq - 1.0) > 0.001) {
        clamped = true;
        entityMask = addPhysicsError(entityMask, PhysicsErrorBitmask.ERROR_ROTATION_UNNORMALIZED);
        const quatNorm = Math.sqrt(quatNormSq);
        if (quatNorm > 1e-6) {
          rx /= quatNorm;
          ry /= quatNorm;
          rz /= quatNorm;
          rw /= quatNorm;
        } else {
          rx = 0;
          ry = 0;
          rz = 0;
          rw = 1.0;
        }
      }

      // 6. Trajectory prediction & desynchronization smoothing
      const prev = this.entityHistory.get(entityId);
      if (this.constraints.enableTrajectoryTracking && prev && frame.deltaTime > 0) {
        const predX = prev.posX + prev.velX * frame.deltaTime;
        const predY = prev.posY + prev.velY * frame.deltaTime;
        const predZ = prev.posZ + prev.velZ * frame.deltaTime;

        const diffX = px - predX;
        const diffY = py - predY;
        const diffZ = pz - predZ;
        const divergence = Math.sqrt(diffX * diffX + diffY * diffY + diffZ * diffZ);

        if (divergence > this.constraints.snapDivergenceThreshold) {
          // Major divergence: VFX-masked snap to predicted trajectory
          vfxSnap = true;
          entityMask = addPhysicsError(entityMask, PhysicsErrorBitmask.ERROR_DIVERGENCE_SNAP);
          px = predX;
          py = predY;
          pz = predZ;
        } else if (divergence > this.constraints.minorDivergenceThreshold) {
          // Minor desynchronization: micro time-dilation & trajectory smoothing
          timeDilated = true;
          entityMask = addPhysicsError(entityMask, PhysicsErrorBitmask.ERROR_TIME_DILATED);
          // Lerp 50% toward predicted position to smooth over jitter
          px = px * 0.5 + predX * 0.5;
          py = py * 0.5 + predY * 0.5;
          pz = pz * 0.5 + predZ * 0.5;
        }
      }

      // Store in working copies
      cPosX[i] = px;
      cPosY[i] = py;
      cPosZ[i] = pz;
      cVelX[i] = vx;
      cVelY[i] = vy;
      cVelZ[i] = vz;
      cRotX[i] = rx;
      cRotY[i] = ry;
      cRotZ[i] = rz;
      cRotW[i] = rw;
      if (cAngX && cAngY && cAngZ) {
        cAngX[i] = ax;
        cAngY[i] = ay;
        cAngZ[i] = az;
      }

      perEntityMasks[i] = entityMask;
    }

    // Pass 2: Intersphere collision detection & dynamic collision threshold resolution (only if radii are provided)
    if (hasRadii) {
      for (let i = 0; i < count; i++) {
        const rI = Number(frame.radii![i]);
        const mI = hasMasses ? Math.max(Number(frame.masses![i]), 0.001) : 1.0;

      for (let j = i + 1; j < count; j++) {
        const rJ = hasRadii ? Number(frame.radii![j]) : 1.0;
        const mJ = hasMasses ? Math.max(Number(frame.masses![j]), 0.001) : 1.0;

        const dx = cPosX[i] - cPosX[j];
        const dy = cPosY[i] - cPosY[j];
        const dz = cPosZ[i] - cPosZ[j];
        const distSq = dx * dx + dy * dy + dz * dz;
        const minDist = rI + rJ;

        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const penetration = minDist - dist;

          if (penetration > 0.001) {
            perEntityMasks[i] = addPhysicsError(perEntityMasks[i], PhysicsErrorBitmask.ERROR_COLLISION_PENETRATION);
            perEntityMasks[j] = addPhysicsError(perEntityMasks[j], PhysicsErrorBitmask.ERROR_COLLISION_PENETRATION);

            // Dynamic collision threshold: scaled by entity sizes and average mass
            const sizeFactor = Math.min(2.0, Math.max(0.5, (rI + rJ) / 2.0));
            const dynamicThreshold = this.constraints.collisionThreshold * sizeFactor;

            // Collision normal pointing from j to i
            let nx = 1.0;
            let ny = 0.0;
            let nz = 0.0;
            if (dist > 1e-6) {
              nx = dx / dist;
              ny = dy / dist;
              nz = dz / dist;
            }

            const totalMass = mI + mJ;
            const wI = mJ / totalMass;
            const wJ = mI / totalMass;

            if (penetration > dynamicThreshold) {
              // Severe collision penetration exceeding dynamic threshold: VFX-masked snap
              vfxSnap = true;
              perEntityMasks[i] = addPhysicsError(perEntityMasks[i], PhysicsErrorBitmask.ERROR_DIVERGENCE_SNAP);
              perEntityMasks[j] = addPhysicsError(perEntityMasks[j], PhysicsErrorBitmask.ERROR_DIVERGENCE_SNAP);

              // Snap completely apart to exact contact surface
              cPosX[i] += nx * penetration * wI;
              cPosY[i] += ny * penetration * wI;
              cPosZ[i] += nz * penetration * wI;

              cPosX[j] -= nx * penetration * wJ;
              cPosY[j] -= ny * penetration * wJ;
              cPosZ[j] -= nz * penetration * wJ;
            } else {
              // Minor collision penetration: smooth via micro time-dilation and soft contact separation
              timeDilated = true;
              perEntityMasks[i] = addPhysicsError(perEntityMasks[i], PhysicsErrorBitmask.ERROR_TIME_DILATED);
              perEntityMasks[j] = addPhysicsError(perEntityMasks[j], PhysicsErrorBitmask.ERROR_TIME_DILATED);

              // Soft contact displacement (50% position adjustment + restitution)
              const sepFactor = 0.5 + 0.5 * this.constraints.collisionRestitution;
              cPosX[i] += nx * penetration * wI * sepFactor;
              cPosY[i] += ny * penetration * wI * sepFactor;
              cPosZ[i] += nz * penetration * wI * sepFactor;

              cPosX[j] -= nx * penetration * wJ * sepFactor;
              cPosY[j] -= ny * penetration * wJ * sepFactor;
              cPosZ[j] -= nz * penetration * wJ * sepFactor;
            }
          }
        }
      }
    }
  }

    // Apply micro time-dilation to deltaTime if minor desynchronization was detected
    if (timeDilated) {
      correctedDeltaTime = frame.deltaTime * this.constraints.microDilationFactor;
      frameErrorBitmask = addPhysicsError(frameErrorBitmask, PhysicsErrorBitmask.ERROR_TIME_DILATED);
    }

    // Aggregate entity error bitmasks and compile failing list
    for (let i = 0; i < count; i++) {
      const mask = perEntityMasks[i];
      if (mask !== PhysicsErrorBitmask.ERROR_NONE) {
        failingEntityIds.push(frame.entityIds[i]);
        entityErrorBitmasks.push(mask);
        frameErrorBitmask = addPhysicsError(frameErrorBitmask, mask);
      }
    }

    // Determine aggregate status code based on priority:
    // 1. STATUS_VFX_SNAP_TRIGGERED (major divergence / deep collision penetration)
    // 2. STATUS_TIME_DILATED (minor desync / soft collision overlap)
    // 3. STATUS_SOFT_CLAMPED (velocity / rotation / bounds / nan clamped)
    // 4. STATUS_OK
    let statusCode: PhysicsStatusCode = PhysicsStatusCode.STATUS_OK;
    if (vfxSnap) {
      statusCode = PhysicsStatusCode.STATUS_VFX_SNAP_TRIGGERED;
      frameErrorBitmask = addPhysicsError(frameErrorBitmask, PhysicsErrorBitmask.ERROR_DIVERGENCE_SNAP);
    } else if (timeDilated) {
      statusCode = PhysicsStatusCode.STATUS_TIME_DILATED;
    } else if (clamped) {
      statusCode = PhysicsStatusCode.STATUS_SOFT_CLAMPED;
    }

    // Update history with final corrected state
    for (let i = 0; i < count; i++) {
      const entityId = frame.entityIds[i];
      this.entityHistory.set(entityId, {
        posX: cPosX[i],
        posY: cPosY[i],
        posZ: cPosZ[i],
        velX: cVelX[i],
        velY: cVelY[i],
        velZ: cVelZ[i],
        rotX: cRotX[i],
        rotY: cRotY[i],
        rotZ: cRotZ[i],
        rotW: cRotW[i],
        frameId: frame.frameId,
        timestampNs: frame.timestampNs,
      });
    }

    // Build corrected frame if corrections were applied
    let correctedFrame: PhysicsFrameSoA | undefined = undefined;
    if (statusCode !== PhysicsStatusCode.STATUS_OK) {
      correctedFrame = {
        frameId: frame.frameId,
        timestampNs: frame.timestampNs,
        deltaTime: correctedDeltaTime,
        mode: frame.mode,
        entityIds: frame.entityIds,
        parentIds: frame.parentIds,
        posX: cPosX,
        posY: cPosY,
        posZ: cPosZ,
        velX: cVelX,
        velY: cVelY,
        velZ: cVelZ,
        rotX: cRotX,
        rotY: cRotY,
        rotZ: cRotZ,
        rotW: cRotW,
        angVelX: cAngX,
        angVelY: cAngY,
        angVelZ: cAngZ,
        radii: frame.radii,
        masses: frame.masses,
      };
    }

    return {
      frameId: frame.frameId,
      statusCode,
      correctedFrame,
      failingEntityIds: failingEntityIds.length > 0 ? failingEntityIds : undefined,
      frameErrorBitmask,
      entityErrorBitmasks: entityErrorBitmasks.length > 0 ? entityErrorBitmasks : undefined,
    };
  }
}

