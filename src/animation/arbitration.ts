import { AnimationIntent, AnimationLayer } from "../proto/index.js";

export interface ArbitrationDecision {
  acceptedIntent: AnimationIntent;
  preempted: boolean;
  preemptedReason?: string;
  layer: AnimationLayer;
}

export interface ActiveIntentRecord {
  intent: AnimationIntent;
  elapsedSeconds: number;
  durationSeconds?: number;
  isUninterruptible: boolean;
}

export interface ArbitratorConfig {
  fullBodyPreemptsAllLayers?: boolean;
  tieBreakerNewestWins?: boolean;
}

// Built-in transient action durations (seconds)
const DEFAULT_ACTION_DURATIONS: Record<string, number> = {
  Jump: 0.8,
  DoubleJump: 0.7,
  DodgeRoll: 0.65,
  LightAttack: 0.45,
  HeavyAttack: 0.9,
  Fire: 0.25,
  Reload: 1.5,
  Recoil: 0.2,
  HitStun: 0.5,
  Parry: 0.35,
  Melee: 0.4,
  Interact: 0.6,
};

/**
 * BridgeSideArbitrator resolves action priority conflicts on the bridge,
 * preventing illegal or conflicting animations before they reach the engine.
 * Supports multi-track layer arbitration, priority tags, and duration expiration.
 */
export class BridgeSideArbitrator {
  private layerRecords: Map<AnimationLayer, ActiveIntentRecord> = new Map();
  private customActionDurations: Map<string, number> = new Map();

  constructor(private readonly config: ArbitratorConfig = { fullBodyPreemptsAllLayers: false, tieBreakerNewestWins: false }) {}

  /**
   * Arbitrates between the currently running intent on the candidate's layer and a newly proposed intent.
   * Higher priority numbers preempt lower priority numbers.
   * Respects "uninterruptible" tags and duration tracking.
   */
  public arbitrate(candidate: AnimationIntent): ArbitrationDecision {
    const layer = candidate.layer ?? AnimationLayer.LAYER_FULL_BODY;
    const active = this.layerRecords.get(layer);

    // If no active intent on this layer, candidate is immediately accepted
    if (!active) {
      this.setActiveRecord(layer, candidate);
      this.preemptSubLayersIfFullBody(candidate);
      return { acceptedIntent: candidate, preempted: false, layer };
    }

    const prevIntent = active.intent;
    const prevPriority = prevIntent.priority;
    const candidatePriority = candidate.priority;

    // Check if active intent is uninterruptible
    const isUninterruptible = active.isUninterruptible;
    const candidateHasOverrideTag = candidate.priorityTags?.some(
      (t) => t === "override" || t === "hit_reaction" || t === "death" || t === "emergency"
    ) ?? false;

    // If active intent is uninterruptible and candidate doesn't have an override tag
    if (isUninterruptible && !candidateHasOverrideTag) {
      return {
        acceptedIntent: prevIntent,
        preempted: false,
        preemptedReason: `Rejected: active intent '${prevIntent.intentName}' is uninterruptible`,
        layer,
      };
    }

    // Determine priority comparison
    const shouldPreempt = this.config.tieBreakerNewestWins
      ? candidatePriority >= prevPriority
      : candidatePriority > prevPriority;

    if (shouldPreempt) {
      this.setActiveRecord(layer, candidate);
      this.preemptSubLayersIfFullBody(candidate);

      return {
        acceptedIntent: candidate,
        preempted: true,
        preemptedReason: `Preempted lower priority intent '${prevIntent.intentName}' with candidate '${candidate.intentName}' (candidate priority ${candidatePriority} > previous ${prevPriority})`,
        layer,
      };
    }

    // Candidate rejected: existing intent retained
    return {
      acceptedIntent: prevIntent,
      preempted: false,
      preemptedReason: `Retained higher priority intent '${prevIntent.intentName}' (active ${prevPriority} >= candidate ${candidatePriority})`,
      layer,
    };
  }

  /**
   * Advances time on all active intent tracks.
   * Returns a list of layers where actions naturally expired and were cleared.
   */
  public advanceTime(dt: number): AnimationLayer[] {
    const expiredLayers: AnimationLayer[] = [];

    for (const [layer, record] of this.layerRecords.entries()) {
      record.elapsedSeconds += dt;

      if (record.durationSeconds !== undefined && record.durationSeconds > 0) {
        if (record.elapsedSeconds >= record.durationSeconds) {
          expiredLayers.push(layer);
          this.layerRecords.delete(layer);
        }
      }
    }

    return expiredLayers;
  }

  /**
   * Registers a custom duration for a specific intent name.
   */
  public setActionDuration(intentName: string, durationSeconds: number): void {
    this.customActionDurations.set(intentName, Math.max(0.01, durationSeconds));
  }

  /**
   * Returns the duration configured for an intent, if any.
   */
  public getActionDuration(intentName: string): number | undefined {
    return this.customActionDurations.get(intentName) ?? DEFAULT_ACTION_DURATIONS[intentName];
  }

  /**
   * Gets the active intent for a specific layer.
   */
  public getActiveIntent(layer: AnimationLayer = AnimationLayer.LAYER_FULL_BODY): AnimationIntent | undefined {
    return this.layerRecords.get(layer)?.intent;
  }

  /**
   * Gets the active record for a specific layer.
   */
  public getActiveRecord(layer: AnimationLayer = AnimationLayer.LAYER_FULL_BODY): ActiveIntentRecord | undefined {
    return this.layerRecords.get(layer);
  }

  /**
   * Returns all active records across all layers.
   */
  public getAllActiveRecords(): Map<AnimationLayer, ActiveIntentRecord> {
    return new Map(this.layerRecords);
  }

  /**
   * Clears active intent on a specific layer, or all layers if not specified.
   */
  public reset(layer?: AnimationLayer): void {
    if (layer !== undefined) {
      this.layerRecords.delete(layer);
    } else {
      this.layerRecords.clear();
    }
  }

  private preemptSubLayersIfFullBody(candidate: AnimationIntent): void {
    const layer = candidate.layer ?? AnimationLayer.LAYER_FULL_BODY;
    if (this.config.fullBodyPreemptsAllLayers && layer === AnimationLayer.LAYER_FULL_BODY) {
      for (const otherLayer of [
        AnimationLayer.LAYER_LOWER_BODY,
        AnimationLayer.LAYER_UPPER_BODY,
        AnimationLayer.LAYER_ADDITIVE,
      ]) {
        const otherActive = this.layerRecords.get(otherLayer);
        if (otherActive && candidate.priority > otherActive.intent.priority) {
          this.layerRecords.delete(otherLayer);
        }
      }
    }
  }

  private setActiveRecord(layer: AnimationLayer, intent: AnimationIntent): void {
    const isUninterruptible =
      intent.priorityTags?.some((t) => t === "uninterruptible" || t === "locked") ?? false;
    const durationSeconds = this.getActionDuration(intent.intentName);

    this.layerRecords.set(layer, {
      intent,
      elapsedSeconds: 0,
      durationSeconds,
      isUninterruptible,
    });
  }
}
