import {
  AnimationIntent,
  AnimationLayer,
  GenreTemplate,
  SynthesizedAnimationState,
} from "../proto/index.js";
import { IntentMapper } from "./intent_mapper.js";
import { BridgeSideArbitrator, ArbitrationDecision } from "./arbitration.js";
import { LayeredWeightStreamer, BlendCurveType } from "./weight_streamer.js";
import { ProceduralPlaybackScaler, Vector3Like } from "./root_motion.js";

export interface EntityPhysicsContext {
  velocity?: number | Vector3Like;
  angularVelocityY?: number;
  onGround?: boolean;
}

export interface SynthesizerOptions {
  genre?: GenreTemplate;
  fullBodyPreemptsAllLayers?: boolean;
  tieBreakerNewestWins?: boolean;
  defaultBlendCurve?: BlendCurveType;
  enableSmoothing?: boolean;
  smoothingFactor?: number;
  minPlaybackScale?: number;
  maxPlaybackScale?: number;
}

interface EntityAnimationRuntime {
  arbitrator: BridgeSideArbitrator;
  streamer: LayeredWeightStreamer;
  lastDecisions: Map<AnimationLayer, ArbitrationDecision>;
  lastNominalVelocity: Map<AnimationLayer, number>;
}

/**
 * AnimationSynthesizer coordinates the end-to-end AI-to-Rig synthesis pipeline:
 * 1. Hybrid Intent-Mapping across standardized genre templates
 * 2. Bridge-Side Multi-Layer Action Priority Arbitration
 * 3. Opt-In Weight Streaming with normalized blend curves
 * 4. Procedural Playback Scaling (Root Motion Physics Authority)
 */
export class AnimationSynthesizer {
  private intentMapper: IntentMapper;
  private playbackScaler: ProceduralPlaybackScaler;
  private entities: Map<number, EntityAnimationRuntime> = new Map();
  private options: Required<SynthesizerOptions>;

  constructor(options: SynthesizerOptions = {}) {
    this.options = {
      genre: options.genre ?? GenreTemplate.GENRE_GENERIC,
      fullBodyPreemptsAllLayers: options.fullBodyPreemptsAllLayers ?? false,
      tieBreakerNewestWins: options.tieBreakerNewestWins ?? false,
      defaultBlendCurve: options.defaultBlendCurve ?? BlendCurveType.SMOOTHSTEP,
      enableSmoothing: options.enableSmoothing ?? true,
      smoothingFactor: options.smoothingFactor ?? 0.25,
      minPlaybackScale: options.minPlaybackScale ?? 0.2,
      maxPlaybackScale: options.maxPlaybackScale ?? 3.0,
    };

    this.intentMapper = new IntentMapper(this.options.genre);
    this.playbackScaler = new ProceduralPlaybackScaler();
  }

  public getIntentMapper(): IntentMapper {
    return this.intentMapper;
  }

  public getPlaybackScaler(): ProceduralPlaybackScaler {
    return this.playbackScaler;
  }

  public setGenre(genre: GenreTemplate): void {
    this.options.genre = genre;
    this.intentMapper.setGenre(genre);
  }

  /**
   * Processes an incoming AI AnimationIntent for a specific entity,
   * arbitrates against active actions, updates blend transitions,
   * applies root motion scaling, and returns the synthesized state.
   */
  public processIntent(
    entityId: number,
    frameId: bigint,
    intent: AnimationIntent,
    physicsContext?: EntityPhysicsContext,
    dt: number = 0.016667
  ): SynthesizedAnimationState {
    const runtime = this.getOrCreateEntityRuntime(entityId);
    const normalized = this.intentMapper.normalizeIntent(intent);
    const targetLayer = normalized.layer ?? AnimationLayer.LAYER_FULL_BODY;

    // 1. Bridge-Side Priority Arbitration
    const decision = runtime.arbitrator.arbitrate(normalized);
    runtime.lastDecisions.set(targetLayer, decision);

    // 2. Resolve final clip name through template & synonyms
    const resolvedClip = this.intentMapper.resolveIntent(decision.acceptedIntent);
    const nominalVel = this.intentMapper.getNominalVelocity(resolvedClip);
    runtime.lastNominalVelocity.set(targetLayer, nominalVel);

    // 3. Initiate or continue blend transition
    const duration = decision.acceptedIntent.blendTransitionDuration ?? 0.2;
    runtime.streamer.transitionLayer(
      targetLayer,
      resolvedClip,
      duration,
      this.options.defaultBlendCurve
    );

    // 4. Update frame blend weights
    const weights = runtime.streamer.updateLayer(targetLayer, dt);

    // 5. Procedural Playback Scaling (Root Motion Physics Authority)
    const effectiveVelocity = physicsContext?.velocity !== undefined
      ? physicsContext.velocity
      : decision.acceptedIntent.desiredVelocity;

    const playbackScale = this.options.enableSmoothing
      ? this.playbackScaler.calculateSmoothedScale(entityId, effectiveVelocity, nominalVel, {
          minScale: this.options.minPlaybackScale,
          maxScale: this.options.maxPlaybackScale,
          smoothingFactor: this.options.smoothingFactor,
          planarOnly: true,
        })
      : this.playbackScaler.calculatePlaybackScale(
          effectiveVelocity,
          nominalVel,
          this.options.minPlaybackScale,
          this.options.maxPlaybackScale
        );

    return {
      entityId,
      frameId,
      activeIntent: resolvedClip,
      blendWeights: weights,
      playbackScale,
      arbitrationPreempted: decision.preempted,
      preemptedReason: decision.preemptedReason,
      layer: targetLayer,
    };
  }

  /**
   * Advances the animation simulation for an entity by delta time dt
   * when no new intent arrives. Handles action expiration (e.g. transient jump/attack ending).
   */
  public tickEntity(
    entityId: number,
    frameId: bigint,
    dt: number = 0.016667,
    physicsContext?: EntityPhysicsContext
  ): SynthesizedAnimationState[] {
    const runtime = this.getOrCreateEntityRuntime(entityId);
    const expiredLayers = runtime.arbitrator.advanceTime(dt);

    // Handle expired one-shot actions
    for (const layer of expiredLayers) {
      const fallback = this.intentMapper.resolveIntent("");
      runtime.streamer.transitionLayer(layer, fallback, 0.2, this.options.defaultBlendCurve);
      runtime.lastDecisions.delete(layer);
    }

    const states: SynthesizedAnimationState[] = [];
    const allLayers = [
      AnimationLayer.LAYER_FULL_BODY,
      AnimationLayer.LAYER_LOWER_BODY,
      AnimationLayer.LAYER_UPPER_BODY,
      AnimationLayer.LAYER_ADDITIVE,
    ];

    for (const layer of allLayers) {
      const streamer = runtime.streamer.getStreamer(layer);
      // If the streamer has an active or transitioning clip
      const currentClip = streamer.getTargetClip();
      if (!currentClip) continue;

      const weights = streamer.updateBlend(dt);
      const nominalVel = this.intentMapper.getNominalVelocity(currentClip);

      const effectiveVelocity = physicsContext?.velocity !== undefined
        ? physicsContext.velocity
        : nominalVel;

      const playbackScale = this.options.enableSmoothing
        ? this.playbackScaler.calculateSmoothedScale(entityId, effectiveVelocity, nominalVel, {
            minScale: this.options.minPlaybackScale,
            maxScale: this.options.maxPlaybackScale,
            smoothingFactor: this.options.smoothingFactor,
          })
        : this.playbackScaler.calculatePlaybackScale(
            effectiveVelocity,
            nominalVel,
            this.options.minPlaybackScale,
            this.options.maxPlaybackScale
          );

      const decision = runtime.lastDecisions.get(layer);

      states.push({
        entityId,
        frameId,
        activeIntent: currentClip,
        blendWeights: weights,
        playbackScale,
        arbitrationPreempted: decision?.preempted ?? false,
        preemptedReason: decision?.preemptedReason,
        layer,
      });
    }

    return states;
  }

  /**
   * Clears state for a specific entity or all entities.
   */
  public reset(entityId?: number): void {
    if (entityId !== undefined) {
      this.entities.delete(entityId);
      this.playbackScaler.reset(entityId);
    } else {
      this.entities.clear();
      this.playbackScaler.reset();
    }
  }

  private getOrCreateEntityRuntime(entityId: number): EntityAnimationRuntime {
    let runtime = this.entities.get(entityId);
    if (!runtime) {
      runtime = {
        arbitrator: new BridgeSideArbitrator({
          fullBodyPreemptsAllLayers: this.options.fullBodyPreemptsAllLayers,
          tieBreakerNewestWins: this.options.tieBreakerNewestWins,
        }),
        streamer: new LayeredWeightStreamer("Idle"),
        lastDecisions: new Map(),
        lastNominalVelocity: new Map(),
      };
      this.entities.set(entityId, runtime);
    }
    return runtime;
  }
}
