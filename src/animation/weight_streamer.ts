import { AnimationBlendWeight, AnimationLayer } from "../proto/index.js";

export enum BlendCurveType {
  LINEAR = "LINEAR",
  SMOOTHSTEP = "SMOOTHSTEP",
  S_CURVE = "S_CURVE",
  EXPONENTIAL = "EXPONENTIAL",
  INSTANT = "INSTANT",
}

export interface FadingClip {
  clipName: string;
  weight: number;
}

/**
 * Evaluates a blend curve for normalized parameter t in [0, 1].
 */
export function evaluateBlendCurve(t: number, curve: BlendCurveType = BlendCurveType.SMOOTHSTEP): number {
  const clampedT = Math.max(0, Math.min(1, t));
  switch (curve) {
    case BlendCurveType.LINEAR:
      return clampedT;
    case BlendCurveType.SMOOTHSTEP:
      // Cubic Hermite: 3t^2 - 2t^3
      return clampedT * clampedT * (3 - 2 * clampedT);
    case BlendCurveType.S_CURVE:
      // Quintic Smootherstep: 6t^5 - 15t^4 + 10t^3
      return clampedT * clampedT * clampedT * (clampedT * (clampedT * 6 - 15) + 10);
    case BlendCurveType.EXPONENTIAL: {
      // Normalized exponential curve (e^(2t) - 1) / (e^2 - 1)
      const e2 = Math.exp(2);
      return (Math.exp(2 * clampedT) - 1) / (e2 - 1);
    }
    case BlendCurveType.INSTANT:
      return clampedT >= 1.0 ? 1.0 : 1.0;
    default:
      return clampedT;
  }
}

/**
 * OptInWeightStreamer calculates smooth frame-by-frame blend weights for animation transitions.
 * Supports configurable blend curves, multi-clip cross-fading, and strict sum-of-weights = 1.0.
 */
export class OptInWeightStreamer {
  private currentClip: string = "Idle";
  private targetClip: string = "Idle";
  private blendProgress: number = 1.0; // 0.0 -> 1.0
  private transitionDuration: number = 0.2; // seconds
  private activeCurve: BlendCurveType = BlendCurveType.SMOOTHSTEP;
  private fadingClips: FadingClip[] = [];

  constructor(initialClip: string = "Idle", defaultCurve: BlendCurveType = BlendCurveType.SMOOTHSTEP) {
    this.currentClip = initialClip;
    this.targetClip = initialClip;
    this.activeCurve = defaultCurve;
  }

  /**
   * Initiates a transition to a new clip with specified duration and blend curve.
   */
  public transitionTo(
    newClip: string,
    durationSeconds: number = 0.2,
    curve: BlendCurveType = BlendCurveType.SMOOTHSTEP
  ): void {
    if (!newClip || newClip.trim() === "") return;

    if (this.targetClip === newClip) {
      // Already targeting this clip; update duration or curve if still transitioning
      if (this.blendProgress < 1.0) {
        this.transitionDuration = Math.max(0.001, durationSeconds);
        this.activeCurve = curve;
      }
      return;
    }

    // Capture current weights before starting new transition
    if (this.blendProgress < 1.0) {
      // Ongoing transition interrupted: snapshot current blend weights
      const currentWeights = this.getCurrentWeights();
      this.fadingClips = currentWeights.filter((w) => w.clipName !== newClip);
    } else {
      this.fadingClips = [{ clipName: this.targetClip, weight: 1.0 }];
    }

    this.currentClip = this.targetClip;
    this.targetClip = newClip;
    this.transitionDuration = Math.max(0.001, durationSeconds);
    this.activeCurve = curve;
    this.blendProgress = curve === BlendCurveType.INSTANT ? 1.0 : 0.0;
  }

  /**
   * Updates blend weights given frame delta time dt.
   * If blendSpeed is provided and transitionDuration was not customized, computes duration = 1 / blendSpeed.
   */
  public updateBlend(dt: number, blendSpeed?: number): AnimationBlendWeight[] {
    const stepDt = Math.max(0, dt);

    if (blendSpeed !== undefined && blendSpeed > 0 && this.transitionDuration === 0.2) {
      // Legacy compatibility: blendSpeed advances progress by dt * blendSpeed
      this.blendProgress = Math.min(1.0, this.blendProgress + stepDt * blendSpeed);
    } else {
      const rate = 1.0 / this.transitionDuration;
      this.blendProgress = Math.min(1.0, this.blendProgress + stepDt * rate);
    }

    if (this.activeCurve === BlendCurveType.INSTANT || this.blendProgress >= 1.0) {
      this.blendProgress = 1.0;
      this.currentClip = this.targetClip;
      this.fadingClips = [];
      return [{ clipName: this.targetClip, weight: 1.0 }];
    }

    return this.getCurrentWeights();
  }

  /**
   * Returns current normalized weights without advancing time.
   */
  public getCurrentWeights(): AnimationBlendWeight[] {
    if (this.blendProgress >= 1.0 || this.currentClip === this.targetClip) {
      return [{ clipName: this.targetClip, weight: 1.0 }];
    }

    const t = evaluateBlendCurve(this.blendProgress, this.activeCurve);
    const targetWeight = Math.max(0, Math.min(1.0, t));
    const fadingScale = 1.0 - targetWeight;

    const results: AnimationBlendWeight[] = [];

    if (this.fadingClips.length > 0) {
      for (const fc of this.fadingClips) {
        const w = fc.weight * fadingScale;
        if (w > 0.0001) {
          results.push({ clipName: fc.clipName, weight: w });
        }
      }
    } else {
      results.push({ clipName: this.currentClip, weight: fadingScale });
    }

    results.push({ clipName: this.targetClip, weight: targetWeight });

    // Strict normalization check: sum of weights = 1.0
    const sum = results.reduce((acc, curr) => acc + curr.weight, 0);
    if (sum > 0.00001 && Math.abs(sum - 1.0) > 0.0001) {
      for (const r of results) {
        r.weight /= sum;
      }
    }

    return results;
  }

  public getCurrentClip(): string {
    return this.currentClip;
  }

  public getTargetClip(): string {
    return this.targetClip;
  }

  public getBlendProgress(): number {
    return this.blendProgress;
  }

  public isTransitioning(): boolean {
    return this.blendProgress < 1.0;
  }

  public reset(initialClip: string = "Idle"): void {
    this.currentClip = initialClip;
    this.targetClip = initialClip;
    this.blendProgress = 1.0;
    this.fadingClips = [];
  }
}

/**
 * LayeredWeightStreamer manages independent blend states across all skeletal layers
 * (Full Body, Lower Body, Upper Body, Additive).
 */
export class LayeredWeightStreamer {
  private layers: Map<AnimationLayer, OptInWeightStreamer> = new Map();

  constructor(defaultInitialClip: string = "Idle") {
    for (const layer of [
      AnimationLayer.LAYER_FULL_BODY,
      AnimationLayer.LAYER_LOWER_BODY,
      AnimationLayer.LAYER_UPPER_BODY,
      AnimationLayer.LAYER_ADDITIVE,
    ]) {
      this.layers.set(layer, new OptInWeightStreamer(defaultInitialClip));
    }
  }

  public getStreamer(layer: AnimationLayer = AnimationLayer.LAYER_FULL_BODY): OptInWeightStreamer {
    let streamer = this.layers.get(layer);
    if (!streamer) {
      streamer = new OptInWeightStreamer("Idle");
      this.layers.set(layer, streamer);
    }
    return streamer;
  }

  public transitionLayer(
    layer: AnimationLayer,
    newClip: string,
    durationSeconds: number = 0.2,
    curve: BlendCurveType = BlendCurveType.SMOOTHSTEP
  ): void {
    this.getStreamer(layer).transitionTo(newClip, durationSeconds, curve);
  }

  public updateLayer(layer: AnimationLayer, dt: number): AnimationBlendWeight[] {
    return this.getStreamer(layer).updateBlend(dt);
  }

  public updateAll(dt: number): Map<AnimationLayer, AnimationBlendWeight[]> {
    const res = new Map<AnimationLayer, AnimationBlendWeight[]>();
    for (const [layer, streamer] of this.layers.entries()) {
      res.set(layer, streamer.updateBlend(dt));
    }
    return res;
  }

  public resetAll(initialClip: string = "Idle"): void {
    for (const streamer of this.layers.values()) {
      streamer.reset(initialClip);
    }
  }
}

