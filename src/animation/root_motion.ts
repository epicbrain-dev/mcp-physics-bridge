export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface ScalingOptions {
  minScale?: number;
  maxScale?: number;
  planarOnly?: boolean;
  smoothingFactor?: number; // alpha for EMA: 1.0 = instant, 0.2 = smooth
  deadbandThreshold?: number;
}

/**
 * ProceduralPlaybackScaler resolves root motion discrepancies by granting
 * absolute authority to the physics velocity and procedurally adjusting animation playback speed.
 * Supports 3D/planar vectors, EMA smoothing to avoid flutter, and turn rate scaling.
 */
export class ProceduralPlaybackScaler {
  private smoothedScales: Map<number, number> = new Map();

  /**
   * Computes effective velocity magnitude from a scalar or 3D vector.
   * If planarOnly is true, ignores vertical (Y) velocity (e.g. falling or jumping).
   */
  public computeVelocityMagnitude(
    velocity: number | Vector3Like,
    planarOnly: boolean = true
  ): number {
    if (typeof velocity === "number") {
      return Math.abs(velocity);
    }
    if (planarOnly) {
      return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    }
    return Math.sqrt(
      velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z
    );
  }

  /**
   * Calculates instantaneous playback scale factor: s = v_actual / v_nominal.
   * Clamped to [minScale, maxScale] to prevent extreme slow-mo or jittery hyper-speed.
   */
  public calculatePlaybackScale(
    actualPhysicsVelocity: number | Vector3Like,
    nominalClipVelocity: number,
    minScale: number = 0.2,
    maxScale: number = 3.0,
    planarOnly: boolean = true
  ): number {
    if (nominalClipVelocity <= 0.001) {
      return 1.0;
    }

    const vMag = this.computeVelocityMagnitude(actualPhysicsVelocity, planarOnly);
    if (vMag <= 0.001) {
      return minScale;
    }

    const rawScale = vMag / nominalClipVelocity;
    return Math.max(minScale, Math.min(maxScale, rawScale));
  }

  /**
   * Calculates a temporally smoothed playback scale using an Exponential Moving Average (EMA).
   * Prevents high-frequency physics collision spikes or frame hitches from jarring animation playback.
   */
  public calculateSmoothedScale(
    entityId: number,
    actualPhysicsVelocity: number | Vector3Like,
    nominalClipVelocity: number,
    options: ScalingOptions = {}
  ): number {
    const minScale = options.minScale ?? 0.2;
    const maxScale = options.maxScale ?? 3.0;
    const planarOnly = options.planarOnly ?? true;
    const alpha = Math.max(0.01, Math.min(1.0, options.smoothingFactor ?? 0.25));
    const deadband = options.deadbandThreshold ?? 0.05;

    const vMag = this.computeVelocityMagnitude(actualPhysicsVelocity, planarOnly);

    if (vMag < deadband && nominalClipVelocity <= 0.001) {
      this.smoothedScales.set(entityId, 1.0);
      return 1.0;
    }

    const targetScale = this.calculatePlaybackScale(
      actualPhysicsVelocity,
      nominalClipVelocity,
      minScale,
      maxScale,
      planarOnly
    );

    const prevScale = this.smoothedScales.get(entityId) ?? targetScale;
    const smoothed = alpha * targetScale + (1.0 - alpha) * prevScale;
    const clamped = Math.max(minScale, Math.min(maxScale, smoothed));

    this.smoothedScales.set(entityId, clamped);
    return clamped;
  }

  /**
   * Calculates playback scaling for turning / rotational movement.
   */
  public calculateAngularScale(
    actualAngularVelocityY: number,
    nominalTurnRate: number,
    minScale: number = 0.2,
    maxScale: number = 2.5
  ): number {
    if (nominalTurnRate <= 0.001) {
      return 1.0;
    }
    const raw = Math.abs(actualAngularVelocityY) / nominalTurnRate;
    return Math.max(minScale, Math.min(maxScale, raw));
  }

  /**
   * Evaluates foot sliding severity as a normalized discrepancy ratio between [0.0, 1.0].
   * 0.0 = perfect foot planting synchronization, 1.0 = severe skating/sliding.
   */
  public calculateFootSlidingMetric(
    actualDisplacement: number,
    nominalDisplacement: number
  ): number {
    const denom = Math.max(Math.abs(actualDisplacement), Math.abs(nominalDisplacement), 0.001);
    const diff = Math.abs(actualDisplacement - nominalDisplacement);
    return Math.min(1.0, diff / denom);
  }

  public reset(entityId?: number): void {
    if (entityId !== undefined) {
      this.smoothedScales.delete(entityId);
    } else {
      this.smoothedScales.clear();
    }
  }
}

