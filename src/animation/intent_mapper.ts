import { GenreTemplate, AnimationLayer, AnimationIntent } from "../proto/index.js";

export interface GenreTemplateConfig {
  supportedIntents: string[];
  defaultFallbackIntent: string;
  nominalVelocities: Record<string, number>;
  layerAffinities?: Record<string, AnimationLayer>;
  synonyms?: Record<string, string>;
}

export const StandardGenreTemplates: Record<GenreTemplate, GenreTemplateConfig> = {
  [GenreTemplate.GENRE_GENERIC]: {
    supportedIntents: ["Idle", "Walk", "Run", "Jump", "Interact", "Fall"],
    defaultFallbackIntent: "Idle",
    nominalVelocities: { Idle: 0, Walk: 2.5, Run: 6.0, Jump: 4.0, Interact: 0, Fall: 5.0 },
    layerAffinities: {
      Interact: AnimationLayer.LAYER_UPPER_BODY,
      Jump: AnimationLayer.LAYER_FULL_BODY,
      Fall: AnimationLayer.LAYER_FULL_BODY,
    },
    synonyms: {
      Move: "Walk",
      Sprint: "Run",
      Jog: "Walk",
      Leap: "Jump",
      Use: "Interact",
      Drop: "Fall",
    },
  },
  [GenreTemplate.GENRE_PLATFORMER]: {
    supportedIntents: ["Idle", "Run", "Skid", "Jump", "DoubleJump", "WallSlide", "Fall", "Dash"],
    defaultFallbackIntent: "Idle",
    nominalVelocities: {
      Idle: 0,
      Run: 8.0,
      Skid: 4.0,
      Jump: 10.0,
      DoubleJump: 10.0,
      WallSlide: 2.0,
      Fall: 5.0,
      Dash: 14.0,
    },
    layerAffinities: {
      WallSlide: AnimationLayer.LAYER_FULL_BODY,
      DoubleJump: AnimationLayer.LAYER_FULL_BODY,
    },
    synonyms: {
      Walk: "Run",
      Sprint: "Dash",
      Slide: "WallSlide",
      Hop: "Jump",
      Land: "Idle",
    },
  },
  [GenreTemplate.GENRE_FPS]: {
    supportedIntents: [
      "Idle",
      "Walk",
      "Sprint",
      "Crouch",
      "CrouchWalk",
      "AimDownSights",
      "Fire",
      "Reload",
      "Recoil",
      "Jump",
      "Melee",
    ],
    defaultFallbackIntent: "Idle",
    nominalVelocities: {
      Idle: 0,
      Walk: 3.5,
      Sprint: 7.0,
      Crouch: 0,
      CrouchWalk: 1.5,
      AimDownSights: 1.5,
      Fire: 0,
      Reload: 0,
      Recoil: 0,
      Jump: 4.0,
      Melee: 2.0,
    },
    layerAffinities: {
      AimDownSights: AnimationLayer.LAYER_UPPER_BODY,
      Fire: AnimationLayer.LAYER_UPPER_BODY,
      Reload: AnimationLayer.LAYER_UPPER_BODY,
      Recoil: AnimationLayer.LAYER_ADDITIVE,
      Melee: AnimationLayer.LAYER_UPPER_BODY,
    },
    synonyms: {
      Shoot: "Fire",
      ADS: "AimDownSights",
      Aim: "AimDownSights",
      Run: "Sprint",
      Sneak: "CrouchWalk",
      Duck: "Crouch",
      Punch: "Melee",
      Strike: "Melee",
      Kick: "Melee",
    },
  },
  [GenreTemplate.GENRE_ACTION_RPG]: {
    supportedIntents: [
      "Idle",
      "Walk",
      "Sprint",
      "DodgeRoll",
      "LightAttack",
      "HeavyAttack",
      "Block",
      "Parry",
      "HitStun",
      "CastSpell",
      "Death",
    ],
    defaultFallbackIntent: "Idle",
    nominalVelocities: {
      Idle: 0,
      Walk: 3.0,
      Sprint: 6.5,
      DodgeRoll: 8.0,
      LightAttack: 1.5,
      HeavyAttack: 0.5,
      Block: 0.8,
      Parry: 0,
      HitStun: 0,
      CastSpell: 0,
      Death: 0,
    },
    layerAffinities: {
      LightAttack: AnimationLayer.LAYER_UPPER_BODY,
      HeavyAttack: AnimationLayer.LAYER_FULL_BODY,
      Block: AnimationLayer.LAYER_UPPER_BODY,
      Parry: AnimationLayer.LAYER_UPPER_BODY,
      CastSpell: AnimationLayer.LAYER_UPPER_BODY,
      DodgeRoll: AnimationLayer.LAYER_FULL_BODY,
      HitStun: AnimationLayer.LAYER_FULL_BODY,
      Death: AnimationLayer.LAYER_FULL_BODY,
    },
    synonyms: {
      Attack: "LightAttack",
      Slash: "LightAttack",
      StrongAttack: "HeavyAttack",
      Roll: "DodgeRoll",
      Dodge: "DodgeRoll",
      Dash: "DodgeRoll",
      Defend: "Block",
      Shield: "Block",
      Hurt: "HitStun",
      Stun: "HitStun",
      Damage: "HitStun",
      Spell: "CastSpell",
      Magic: "CastSpell",
      Die: "Death",
    },
  },
  [GenreTemplate.GENRE_VEHICLE]: {
    supportedIntents: ["Parked", "Accelerate", "Coast", "Brake", "Reverse", "Drift", "Handbrake", "Boost"],
    defaultFallbackIntent: "Parked",
    nominalVelocities: {
      Parked: 0,
      Accelerate: 20.0,
      Coast: 15.0,
      Brake: 5.0,
      Reverse: 8.0,
      Drift: 15.0,
      Handbrake: 2.0,
      Boost: 35.0,
    },
    layerAffinities: {
      Drift: AnimationLayer.LAYER_ADDITIVE,
      Boost: AnimationLayer.LAYER_ADDITIVE,
    },
    synonyms: {
      Idle: "Parked",
      Drive: "Accelerate",
      Gas: "Accelerate",
      Slow: "Brake",
      Stop: "Brake",
      BackUp: "Reverse",
      Turn: "Drift",
      Turbo: "Boost",
      Nitro: "Boost",
    },
  },
};

/**
 * IntentMapper maps AI high-level intents to engine animations,
 * resolving missing actions gracefully using standardized genre templates,
 * built-in semantic synonyms, and custom dictionary mappings.
 */
export class IntentMapper {
  private templates: Map<GenreTemplate, GenreTemplateConfig>;
  private customMappings: Map<string, string> = new Map();
  private customNominalVelocities: Map<string, number> = new Map();

  constructor(private currentGenre: GenreTemplate = GenreTemplate.GENRE_GENERIC) {
    this.templates = new Map();
    for (const [key, cfg] of Object.entries(StandardGenreTemplates)) {
      this.templates.set(Number(key) as GenreTemplate, { ...cfg });
    }
  }

  public setGenre(genre: GenreTemplate): void {
    this.currentGenre = genre;
  }

  public getGenre(): GenreTemplate {
    return this.currentGenre;
  }

  /**
   * Registers or overrides a genre template configuration.
   */
  public registerGenreTemplate(genre: GenreTemplate, config: GenreTemplateConfig): void {
    this.templates.set(genre, config);
  }

  /**
   * Registers a custom synonym/alias mapping from an AI intent name to a target clip name.
   */
  public registerCustomIntentMapping(aiIntent: string, targetClip: string): void {
    this.customMappings.set(aiIntent.toLowerCase(), targetClip);
  }

  /**
   * Registers or overrides a nominal velocity for a specific clip name.
   */
  public registerNominalVelocity(clipName: string, velocity: number): void {
    this.customNominalVelocities.set(clipName, Math.max(0, velocity));
  }

  /**
   * Resolves an incoming intent (object or string) to a supported clip name:
   * 1. Check custom user mappings.
   * 2. Check direct match in active genre template.
   * 3. Check built-in template synonyms.
   * 4. Fall back to template's defaultFallbackIntent.
   */
  public resolveIntent(intent: AnimationIntent | string): string {
    const rawName = typeof intent === "string" ? intent : intent.intentName;
    if (!rawName || typeof rawName !== "string" || rawName.trim() === "") {
      const template = this.getActiveTemplate();
      return template.defaultFallbackIntent;
    }

    const trimmed = rawName.trim();
    const lower = trimmed.toLowerCase();

    // 1. Custom registered mapping
    if (this.customMappings.has(lower)) {
      return this.customMappings.get(lower)!;
    }

    const template = this.getActiveTemplate();

    // 2. Direct match in supported intents (case-sensitive first, then case-insensitive)
    if (template.supportedIntents.includes(trimmed)) {
      return trimmed;
    }
    const matchedSupported = template.supportedIntents.find(
      (si) => si.toLowerCase() === lower
    );
    if (matchedSupported) {
      return matchedSupported;
    }

    // 3. Synonym check in template
    if (template.synonyms) {
      for (const [synKey, target] of Object.entries(template.synonyms)) {
        if (synKey.toLowerCase() === lower) {
          return target;
        }
      }
    }

    // 4. Default fallback
    return template.defaultFallbackIntent;
  }

  /**
   * Returns the nominal reference velocity for an animation clip.
   */
  public getNominalVelocity(clipName: string): number {
    if (this.customNominalVelocities.has(clipName)) {
      return this.customNominalVelocities.get(clipName)!;
    }

    const template = this.getActiveTemplate();
    if (template.nominalVelocities[clipName] !== undefined) {
      return template.nominalVelocities[clipName];
    }

    return 1.0;
  }

  /**
   * Returns the recommended default animation layer for a clip.
   */
  public getLayerAffinity(clipName: string): AnimationLayer {
    const template = this.getActiveTemplate();
    if (template.layerAffinities && template.layerAffinities[clipName] !== undefined) {
      return template.layerAffinities[clipName];
    }
    return AnimationLayer.LAYER_FULL_BODY;
  }

  /**
   * Normalizes an AnimationIntent by validating fields, clamping intensity [0, 1],
   * non-negative velocity, applying layer affinities if unspecified, and ensuring blend duration.
   */
  public normalizeIntent(intent: AnimationIntent): AnimationIntent {
    const resolved = this.resolveIntent(intent);
    const clampedIntensity = Math.max(0, Math.min(1.0, isNaN(intent.intensity) ? 1.0 : intent.intensity));
    const cleanVelocity = Math.max(0, isNaN(intent.desiredVelocity) ? 0 : intent.desiredVelocity);
    const cleanPriority = Math.max(0, isNaN(intent.priority) ? 0 : Math.floor(intent.priority));
    const cleanDuration =
      intent.blendTransitionDuration !== undefined && !isNaN(intent.blendTransitionDuration)
        ? Math.max(0.01, intent.blendTransitionDuration)
        : 0.2;

    const layer =
      intent.layer !== undefined && intent.layer !== null
        ? intent.layer
        : this.getLayerAffinity(resolved);

    return {
      intentName: resolved,
      priority: cleanPriority,
      desiredVelocity: cleanVelocity,
      intensity: clampedIntensity,
      layer,
      priorityTags: intent.priorityTags ? [...intent.priorityTags] : [],
      blendTransitionDuration: cleanDuration,
    };
  }

  private getActiveTemplate(): GenreTemplateConfig {
    const template = this.templates.get(this.currentGenre);
    if (template) {
      return template;
    }
    return StandardGenreTemplates[GenreTemplate.GENRE_GENERIC];
  }
}
