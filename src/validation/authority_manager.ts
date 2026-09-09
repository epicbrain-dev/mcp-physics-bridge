import { EngineMode, PhysicsFrameSoA, PhysicsValidationResponse } from "../proto/index.js";
import { PlaytestModeValidator, PlaytestConstraints } from "./playtest_mode.js";
import { DebugModeValidator, DebugModeConstraints } from "./debug_mode.js";

/**
 * StateAuthorityManager enforces the game engine's ultimate state authority.
 * Routes physics frames to either PlaytestModeValidator or DebugModeValidator,
 * managing session history, deterministic lockstep, and runtime safety constraints.
 */
export class StateAuthorityManager {
  private playtestValidator: PlaytestModeValidator;
  private debugValidator: DebugModeValidator;

  constructor(
    playtestValidator?: PlaytestModeValidator,
    debugValidator?: DebugModeValidator
  ) {
    this.playtestValidator = playtestValidator ?? new PlaytestModeValidator();
    this.debugValidator = debugValidator ?? new DebugModeValidator();
  }

  /**
   * Validates an incoming Struct of Arrays physics frame based on its EngineMode.
   */
  public validateFrame(frame: PhysicsFrameSoA): PhysicsValidationResponse {
    if (frame.mode === EngineMode.DEBUG) {
      return this.debugValidator.validateStrict(frame);
    }
    return this.playtestValidator.validateAndSmooth(frame);
  }

  /**
   * Resets all cached history and sequence state across both validators
   * (e.g. on scene transitions, level resets, or client reconnections).
   */
  public reset(): void {
    this.playtestValidator.reset();
    this.debugValidator.reset();
  }

  /**
   * Alias for reset().
   */
  public resetHistory(): void {
    this.reset();
  }

  /**
   * Updates Playtest Mode runtime constraints.
   */
  public configurePlaytest(constraints: Partial<PlaytestConstraints>): void {
    this.playtestValidator.setConstraints(constraints);
  }

  /**
   * Updates Debug Mode runtime constraints.
   */
  public configureDebug(constraints: Partial<DebugModeConstraints>): void {
    this.debugValidator.setConstraints(constraints);
  }

  /**
   * Retrieves the active PlaytestModeValidator instance.
   */
  public getPlaytestValidator(): PlaytestModeValidator {
    return this.playtestValidator;
  }

  /**
   * Retrieves the active DebugModeValidator instance.
   */
  public getDebugValidator(): DebugModeValidator {
    return this.debugValidator;
  }
}

