import { describe, it, expect, beforeEach } from "vitest";
import {
  IntentMapper,
  StandardGenreTemplates,
} from "../../src/animation/intent_mapper.js";
import { GenreTemplate, AnimationLayer, AnimationIntent } from "../../src/proto/index.js";

describe("IntentMapper (Hybrid Intent-Mapping & Genre Templates)", () => {
  let mapper: IntentMapper;

  beforeEach(() => {
    mapper = new IntentMapper(GenreTemplate.GENRE_GENERIC);
  });

  describe("Standard Genre Templates & Default Mappings", () => {
    it("resolves supported intents for GENRE_GENERIC", () => {
      mapper.setGenre(GenreTemplate.GENRE_GENERIC);
      expect(mapper.resolveIntent("Idle")).toBe("Idle");
      expect(mapper.resolveIntent("Walk")).toBe("Walk");
      expect(mapper.resolveIntent("Run")).toBe("Run");
      expect(mapper.resolveIntent("Jump")).toBe("Jump");
      expect(mapper.resolveIntent("Interact")).toBe("Interact");
      expect(mapper.resolveIntent("Fall")).toBe("Fall");
    });

    it("resolves supported intents for GENRE_PLATFORMER", () => {
      mapper.setGenre(GenreTemplate.GENRE_PLATFORMER);
      expect(mapper.resolveIntent("Run")).toBe("Run");
      expect(mapper.resolveIntent("WallSlide")).toBe("WallSlide");
      expect(mapper.resolveIntent("DoubleJump")).toBe("DoubleJump");
      expect(mapper.resolveIntent("Dash")).toBe("Dash");
      expect(mapper.resolveIntent("Skid")).toBe("Skid");
    });

    it("resolves supported intents for GENRE_FPS", () => {
      mapper.setGenre(GenreTemplate.GENRE_FPS);
      expect(mapper.resolveIntent("AimDownSights")).toBe("AimDownSights");
      expect(mapper.resolveIntent("Fire")).toBe("Fire");
      expect(mapper.resolveIntent("Reload")).toBe("Reload");
      expect(mapper.resolveIntent("Recoil")).toBe("Recoil");
      expect(mapper.resolveIntent("Sprint")).toBe("Sprint");
      expect(mapper.resolveIntent("Crouch")).toBe("Crouch");
      expect(mapper.resolveIntent("Melee")).toBe("Melee");
    });

    it("resolves supported intents for GENRE_ACTION_RPG", () => {
      mapper.setGenre(GenreTemplate.GENRE_ACTION_RPG);
      expect(mapper.resolveIntent("DodgeRoll")).toBe("DodgeRoll");
      expect(mapper.resolveIntent("LightAttack")).toBe("LightAttack");
      expect(mapper.resolveIntent("HeavyAttack")).toBe("HeavyAttack");
      expect(mapper.resolveIntent("Parry")).toBe("Parry");
      expect(mapper.resolveIntent("Block")).toBe("Block");
      expect(mapper.resolveIntent("HitStun")).toBe("HitStun");
      expect(mapper.resolveIntent("CastSpell")).toBe("CastSpell");
      expect(mapper.resolveIntent("Death")).toBe("Death");
    });

    it("resolves supported intents for GENRE_VEHICLE", () => {
      mapper.setGenre(GenreTemplate.GENRE_VEHICLE);
      expect(mapper.resolveIntent("Parked")).toBe("Parked");
      expect(mapper.resolveIntent("Accelerate")).toBe("Accelerate");
      expect(mapper.resolveIntent("Coast")).toBe("Coast");
      expect(mapper.resolveIntent("Brake")).toBe("Brake");
      expect(mapper.resolveIntent("Reverse")).toBe("Reverse");
      expect(mapper.resolveIntent("Drift")).toBe("Drift");
      expect(mapper.resolveIntent("Boost")).toBe("Boost");
    });
  });

  describe("Built-In Semantic Synonyms & Case Insensitivity", () => {
    it("maps FPS synonyms (e.g. Shoot -> Fire, ADS -> AimDownSights, Duck -> Crouch)", () => {
      mapper.setGenre(GenreTemplate.GENRE_FPS);
      expect(mapper.resolveIntent("Shoot")).toBe("Fire");
      expect(mapper.resolveIntent("shoot")).toBe("Fire");
      expect(mapper.resolveIntent("ADS")).toBe("AimDownSights");
      expect(mapper.resolveIntent("Aim")).toBe("AimDownSights");
      expect(mapper.resolveIntent("Duck")).toBe("Crouch");
      expect(mapper.resolveIntent("Punch")).toBe("Melee");
      expect(mapper.resolveIntent("Sneak")).toBe("CrouchWalk");
    });

    it("maps Action RPG synonyms (e.g. Attack -> LightAttack, Roll -> DodgeRoll, Hurt -> HitStun)", () => {
      mapper.setGenre(GenreTemplate.GENRE_ACTION_RPG);
      expect(mapper.resolveIntent("Attack")).toBe("LightAttack");
      expect(mapper.resolveIntent("Slash")).toBe("LightAttack");
      expect(mapper.resolveIntent("StrongAttack")).toBe("HeavyAttack");
      expect(mapper.resolveIntent("Roll")).toBe("DodgeRoll");
      expect(mapper.resolveIntent("Dodge")).toBe("DodgeRoll");
      expect(mapper.resolveIntent("Hurt")).toBe("HitStun");
      expect(mapper.resolveIntent("Stun")).toBe("HitStun");
      expect(mapper.resolveIntent("Magic")).toBe("CastSpell");
      expect(mapper.resolveIntent("Die")).toBe("Death");
    });

    it("maps Vehicle synonyms (e.g. Drive -> Accelerate, Gas -> Accelerate, Nitro -> Boost)", () => {
      mapper.setGenre(GenreTemplate.GENRE_VEHICLE);
      expect(mapper.resolveIntent("Drive")).toBe("Accelerate");
      expect(mapper.resolveIntent("Gas")).toBe("Accelerate");
      expect(mapper.resolveIntent("Slow")).toBe("Brake");
      expect(mapper.resolveIntent("Turn")).toBe("Drift");
      expect(mapper.resolveIntent("Nitro")).toBe("Boost");
      expect(mapper.resolveIntent("BackUp")).toBe("Reverse");
    });

    it("resolves case-insensitively for direct supported intents", () => {
      mapper.setGenre(GenreTemplate.GENRE_GENERIC);
      expect(mapper.resolveIntent("walk")).toBe("Walk");
      expect(mapper.resolveIntent("RUN")).toBe("Run");
      expect(mapper.resolveIntent("jUmP")).toBe("Jump");
    });
  });

  describe("Fallback Resolution", () => {
    it("falls back to defaultFallbackIntent when an unsupported action is requested", () => {
      mapper.setGenre(GenreTemplate.GENRE_PLATFORMER);
      expect(mapper.resolveIntent("CastFireball")).toBe("Idle");

      mapper.setGenre(GenreTemplate.GENRE_VEHICLE);
      expect(mapper.resolveIntent("DoAFlip")).toBe("Parked");
    });

    it("falls back to defaultFallbackIntent when given empty or whitespace intent names", () => {
      mapper.setGenre(GenreTemplate.GENRE_GENERIC);
      expect(mapper.resolveIntent("")).toBe("Idle");
      expect(mapper.resolveIntent("   ")).toBe("Idle");
    });
  });

  describe("Custom Dictionary Registrations", () => {
    it("allows registering custom intent synonyms overriding default mappings", () => {
      mapper.setGenre(GenreTemplate.GENRE_ACTION_RPG);
      mapper.registerCustomIntentMapping("SpinSlash", "HeavyAttack");
      mapper.registerCustomIntentMapping("BlinkTeleport", "DodgeRoll");

      expect(mapper.resolveIntent("SpinSlash")).toBe("HeavyAttack");
      expect(mapper.resolveIntent("BlinkTeleport")).toBe("DodgeRoll");
    });

    it("allows registering and overriding nominal velocities", () => {
      mapper.setGenre(GenreTemplate.GENRE_GENERIC);
      expect(mapper.getNominalVelocity("Run")).toBe(6.0);

      mapper.registerNominalVelocity("Run", 8.5);
      expect(mapper.getNominalVelocity("Run")).toBe(8.5);

      mapper.registerNominalVelocity("SuperSprint", 15.0);
      expect(mapper.getNominalVelocity("SuperSprint")).toBe(15.0);
    });

    it("allows registering an entirely new genre template configuration", () => {
      const customGenre = 99 as GenreTemplate;
      mapper.registerGenreTemplate(customGenre, {
        supportedIntents: ["Hover", "Thrust", "Land"],
        defaultFallbackIntent: "Hover",
        nominalVelocities: { Hover: 0, Thrust: 12.0, Land: 1.0 },
      });

      mapper.setGenre(customGenre);
      expect(mapper.resolveIntent("Thrust")).toBe("Thrust");
      expect(mapper.resolveIntent("Teleport")).toBe("Hover");
      expect(mapper.getNominalVelocity("Thrust")).toBe(12.0);
    });
  });

  describe("Layer Affinities & Intent Normalization", () => {
    it("correctly identifies layer affinities for clips", () => {
      mapper.setGenre(GenreTemplate.GENRE_FPS);
      expect(mapper.getLayerAffinity("Fire")).toBe(AnimationLayer.LAYER_UPPER_BODY);
      expect(mapper.getLayerAffinity("AimDownSights")).toBe(AnimationLayer.LAYER_UPPER_BODY);
      expect(mapper.getLayerAffinity("Recoil")).toBe(AnimationLayer.LAYER_ADDITIVE);
      expect(mapper.getLayerAffinity("Walk")).toBe(AnimationLayer.LAYER_FULL_BODY);
    });

    it("normalizes an AnimationIntent object with clamping and defaults", () => {
      mapper.setGenre(GenreTemplate.GENRE_FPS);
      const rawIntent: AnimationIntent = {
        intentName: "Shoot", // synonym for Fire
        priority: 15.7,     // float -> floor 15
        desiredVelocity: -5.0, // negative -> 0
        intensity: 2.5,        // > 1 -> clamp 1.0
      };

      const normalized = mapper.normalizeIntent(rawIntent);
      expect(normalized.intentName).toBe("Fire");
      expect(normalized.priority).toBe(15);
      expect(normalized.desiredVelocity).toBe(0);
      expect(normalized.intensity).toBe(1.0);
      expect(normalized.layer).toBe(AnimationLayer.LAYER_UPPER_BODY); // inferred from affinity
      expect(normalized.blendTransitionDuration).toBe(0.2); // default
      expect(normalized.priorityTags).toEqual([]);
    });
  });
});
