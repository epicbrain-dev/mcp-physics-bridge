import { describe, it, expect, beforeEach } from "vitest";
import { StateAuthorityManager } from "../../src/validation/authority_manager.js";
import {
  EngineMode,
  PhysicsFrameSoA,
  PhysicsStatusCode,
  PhysicsErrorBitmask,
  hasPhysicsError,
  formatPhysicsErrors,
} from "../../src/proto/index.js";

describe("StateAuthorityManager (Playtest vs Debug Mode)", () => {
  let manager: StateAuthorityManager;

  beforeEach(() => {
    manager = new StateAuthorityManager();
  });

  // ==========================================
  // PLAYTEST MODE TESTS
  // ==========================================

  it("handles valid frames in Playtest Mode without generating unnecessary correctedFrame", () => {
    const validFrame: PhysicsFrameSoA = {
      frameId: 1n,
      timestampNs: 1000n,
      deltaTime: 0.016,
      mode: EngineMode.PLAYTEST,
      entityIds: [1],
      posX: [0],
      posY: [0],
      posZ: [0],
      velX: [5],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
      angVelX: [0],
      angVelY: [0],
      angVelZ: [0],
      radii: [1.0],
      masses: [10.0],
    };

    const result = manager.validateFrame(validFrame);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_OK);
    expect(result.frameErrorBitmask).toBe(PhysicsErrorBitmask.ERROR_NONE);
    expect(result.correctedFrame).toBeUndefined();
  });

  it("applies soft clamping and scales velocity vectors in Playtest Mode", () => {
    const highSpeedFrame: PhysicsFrameSoA = {
      frameId: 2n,
      timestampNs: 2000n,
      deltaTime: 0.016,
      mode: EngineMode.PLAYTEST,
      entityIds: [10],
      posX: [0],
      posY: [0],
      posZ: [0],
      velX: [100], // Exceeds maxLinearVelocity = 50.0
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
      angVelX: [0],
      angVelY: [35], // Exceeds maxAngularVelocity = 25.0
      angVelZ: [0],
    };

    const result = manager.validateFrame(highSpeedFrame);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_SOFT_CLAMPED);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_LINEAR_VEL_EXCEEDED)).toBe(true);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_ANGULAR_VEL_EXCEEDED)).toBe(true);
    expect(result.entityErrorBitmasks?.[0]).toBe(result.frameErrorBitmask);

    // Verify correctedFrame contains clamped values
    expect(result.correctedFrame).toBeDefined();
    expect(result.correctedFrame!.velX[0]).toBeCloseTo(50.0, 4);
    expect(result.correctedFrame!.angVelY![0]).toBeCloseTo(25.0, 4);
  });

  it("soft clamps world bounds and normalizes quaternions in Playtest Mode", () => {
    const oobFrame: PhysicsFrameSoA = {
      frameId: 5n,
      timestampNs: 5000n,
      deltaTime: 0.016,
      mode: EngineMode.PLAYTEST,
      entityIds: [20],
      posX: [25000.0], // Exceeds 10,000 bounds
      posY: [-12000.0],
      posZ: [0],
      velX: [0],
      velY: [0],
      velZ: [0],
      rotX: [2.0], // Unnormalized (norm = 2.0)
      rotY: [0],
      rotZ: [0],
      rotW: [0],
    };

    const result = manager.validateFrame(oobFrame);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_SOFT_CLAMPED);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_OUT_OF_BOUNDS)).toBe(true);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_ROTATION_UNNORMALIZED)).toBe(true);

    expect(result.correctedFrame).toBeDefined();
    expect(result.correctedFrame!.posX[0]).toBe(10000.0);
    expect(result.correctedFrame!.posY[0]).toBe(-10000.0);
    expect(result.correctedFrame!.rotX[0]).toBeCloseTo(1.0, 4);
  });

  it("soft handles NaN values in Playtest Mode without crashing", () => {
    const nanFrame: PhysicsFrameSoA = {
      frameId: 6n,
      timestampNs: 6000n,
      deltaTime: 0.016,
      mode: EngineMode.PLAYTEST,
      entityIds: [30],
      posX: [NaN],
      posY: [0],
      posZ: [0],
      velX: [NaN],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };

    const result = manager.validateFrame(nanFrame);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_SOFT_CLAMPED);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_NAN_OR_INF)).toBe(true);
    expect(result.correctedFrame).toBeDefined();
    expect(Number.isFinite(result.correctedFrame!.posX[0])).toBe(true);
    expect(Number.isFinite(result.correctedFrame!.velX[0])).toBe(true);
    expect(result.correctedFrame!.posX[0]).toBe(0);
    expect(result.correctedFrame!.velX[0]).toBe(0);
  });

  it("smoothes minor collision overlap using micro time-dilation in Playtest Mode", () => {
    // Entities 1 and 2 overlap slightly: dist = 1.8, sum of radii = 2.0 (overlap = 0.2 < threshold 2.0)
    const overlapFrame: PhysicsFrameSoA = {
      frameId: 7n,
      timestampNs: 7000n,
      deltaTime: 0.016,
      mode: EngineMode.PLAYTEST,
      entityIds: [1, 2],
      posX: [0, 1.8],
      posY: [0, 0],
      posZ: [0, 0],
      velX: [0, 0],
      velY: [0, 0],
      velZ: [0, 0],
      rotX: [0, 0],
      rotY: [0, 0],
      rotZ: [0, 0],
      rotW: [1, 1],
      radii: [1.0, 1.0],
      masses: [1.0, 1.0],
    };

    const result = manager.validateFrame(overlapFrame);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_TIME_DILATED);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_COLLISION_PENETRATION)).toBe(true);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_TIME_DILATED)).toBe(true);

    expect(result.correctedFrame).toBeDefined();
    // DeltaTime scaled by microDilationFactor (0.85)
    expect(result.correctedFrame!.deltaTime).toBeCloseTo(0.016 * 0.85, 5);
    // Entities soft separated
    expect(result.correctedFrame!.posX[0]).toBeLessThan(0);
    expect(result.correctedFrame!.posX[1]).toBeGreaterThan(1.8);
  });

  it("triggers VFX-masked snap on deep collision penetration exceeding dynamic threshold in Playtest Mode", () => {
    // Deep penetration: dist = 0.5, sum of radii = 4.0, penetration = 3.5 > dynamic threshold 2.0 * 2.0 = 4.0?
    // Let radii = [1.0, 1.0], sum = 2.0, threshold = 2.0 * 1.0 = 2.0. dist = 0.1, penetration = 1.9?
    // Let's set penetration > dynamic threshold:
    // radii = [1.0, 1.0], sizeFactor = 1.0, dynamicThreshold = 1.0 * 2.0 = 2.0.
    // If radii = [2.0, 2.0], sum = 4.0, dist = 0.5, penetration = 3.5. dynamicThreshold = 2.0 * 2.0 = 4.0.
    // To exceed dynamicThreshold with radii [1.0, 1.0]: dynamicThreshold is 2.0. If dist = -1? Dist cannot be negative.
    // Let's configure collisionThreshold to 1.0:
    manager.configurePlaytest({ collisionThreshold: 1.0 });

    const snapFrame: PhysicsFrameSoA = {
      frameId: 8n,
      timestampNs: 8000n,
      deltaTime: 0.016,
      mode: EngineMode.PLAYTEST,
      entityIds: [1, 2],
      posX: [0, 0.5], // dist = 0.5, sum of radii = 2.0, penetration = 1.5 > threshold 1.0
      posY: [0, 0],
      posZ: [0, 0],
      velX: [0, 0],
      velY: [0, 0],
      velZ: [0, 0],
      rotX: [0, 0],
      rotY: [0, 0],
      rotZ: [0, 0],
      rotW: [1, 1],
      radii: [1.0, 1.0],
      masses: [1.0, 1.0],
    };

    const result = manager.validateFrame(snapFrame);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_VFX_SNAP_TRIGGERED);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_DIVERGENCE_SNAP)).toBe(true);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_COLLISION_PENETRATION)).toBe(true);

    expect(result.correctedFrame).toBeDefined();
    // Verify entities are completely snapped apart to contact surface (dist = 2.0)
    const newDist = result.correctedFrame!.posX[1] - result.correctedFrame!.posX[0];
    expect(newDist).toBeCloseTo(2.0, 3);
  });

  it("handles trajectory desynchronization and VFX snaps when enableTrajectoryTracking is enabled", () => {
    manager.configurePlaytest({ enableTrajectoryTracking: true, minorDivergenceThreshold: 0.5, snapDivergenceThreshold: 5.0 });

    // Frame 1: entity at 0 moving with velocity 10
    const frame1: PhysicsFrameSoA = {
      frameId: 10n,
      timestampNs: 10000000n,
      deltaTime: 0.1,
      mode: EngineMode.PLAYTEST,
      entityIds: [5],
      posX: [0],
      posY: [0],
      posZ: [0],
      velX: [10],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };
    manager.validateFrame(frame1);

    // Frame 2: expected pos = 0 + 10 * 0.1 = 1.0. Incoming pos = 2.0 (diff = 1.0 > minor 0.5)
    const frame2: PhysicsFrameSoA = {
      frameId: 11n,
      timestampNs: 20000000n,
      deltaTime: 0.1,
      mode: EngineMode.PLAYTEST,
      entityIds: [5],
      posX: [2.0],
      posY: [0],
      posZ: [0],
      velX: [10],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };
    const res2 = manager.validateFrame(frame2);
    expect(res2.statusCode).toBe(PhysicsStatusCode.STATUS_TIME_DILATED);
    expect(hasPhysicsError(res2.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_TIME_DILATED)).toBe(true);

    // Frame 3: expected pos = 1.5 + 10 * 0.1 = 2.5. Incoming pos = 25.0 (diff = 22.5 > snap 5.0)
    const frame3: PhysicsFrameSoA = {
      frameId: 12n,
      timestampNs: 30000000n,
      deltaTime: 0.1,
      mode: EngineMode.PLAYTEST,
      entityIds: [5],
      posX: [25.0],
      posY: [0],
      posZ: [0],
      velX: [10],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };
    const res3 = manager.validateFrame(frame3);
    expect(res3.statusCode).toBe(PhysicsStatusCode.STATUS_VFX_SNAP_TRIGGERED);
    expect(hasPhysicsError(res3.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_DIVERGENCE_SNAP)).toBe(true);
    expect(res3.correctedFrame!.posX[0]).toBeCloseTo(2.5, 2);
  });

  // ==========================================
  // DEBUG MODE TESTS
  // ==========================================

  it("strictly rejects NaN values in Debug Mode with synchronized bitmasks", () => {
    const nanFrame: PhysicsFrameSoA = {
      frameId: 3n,
      timestampNs: 3000n,
      deltaTime: 0.016,
      mode: EngineMode.DEBUG,
      entityIds: [42],
      posX: [NaN],
      posY: [0],
      posZ: [0],
      velX: [0],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };

    const result = manager.validateFrame(nanFrame);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_NAN_DETECTED);
    expect(result.failingEntityIds).toContain(42);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_NAN_OR_INF)).toBe(true);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_STRICT_REJECTED)).toBe(true);
    expect(result.entityErrorBitmasks?.[0]).toBe(result.frameErrorBitmask);
    expect(result.correctedFrame).toBeUndefined(); // Safety nets disabled!
  });

  it("detects unnormalized rotation and out-of-bounds positions in Debug Mode", () => {
    const corruptFrame: PhysicsFrameSoA = {
      frameId: 4n,
      timestampNs: 4000n,
      deltaTime: 0.016,
      mode: EngineMode.DEBUG,
      entityIds: [99],
      posX: [50000.0], // Out of bounds (> 10,000)
      posY: [0],
      posZ: [0],
      velX: [0],
      velY: [0],
      velZ: [0],
      rotX: [2.0], // Unnormalized (norm sq = 4 != 1)
      rotY: [0],
      rotZ: [0],
      rotW: [0],
    };

    const result = manager.validateFrame(corruptFrame);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_HARD_REJECTED);
    expect(result.failingEntityIds).toContain(99);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_OUT_OF_BOUNDS)).toBe(true);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_ROTATION_UNNORMALIZED)).toBe(true);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_STRICT_REJECTED)).toBe(true);

    const formatted = formatPhysicsErrors(result.frameErrorBitmask!);
    expect(formatted).toContain("OUT_OF_BOUNDS");
    expect(formatted).toContain("ROTATION_UNNORMALIZED");
    expect(formatted).toContain("STRICT_REJECTED");
  });

  it("strictly rejects excessive velocity in Debug Mode", () => {
    const highVelFrame: PhysicsFrameSoA = {
      frameId: 20n,
      timestampNs: 20000n,
      deltaTime: 0.016,
      mode: EngineMode.DEBUG,
      entityIds: [50],
      posX: [0],
      posY: [0],
      posZ: [0],
      velX: [120], // Exceeds 50
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };

    const result = manager.validateFrame(highVelFrame);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_HARD_REJECTED);
    expect(result.failingEntityIds).toContain(50);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_LINEAR_VEL_EXCEEDED)).toBe(true);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_STRICT_REJECTED)).toBe(true);
  });

  it("strictly rejects sphere collision penetration in Debug Mode", () => {
    const colFrame: PhysicsFrameSoA = {
      frameId: 21n,
      timestampNs: 21000n,
      deltaTime: 0.016,
      mode: EngineMode.DEBUG,
      entityIds: [101, 102],
      posX: [0, 1.5], // Distance 1.5, sum of radii = 2.0 (overlap = 0.5)
      posY: [0, 0],
      posZ: [0, 0],
      velX: [0, 0],
      velY: [0, 0],
      velZ: [0, 0],
      rotX: [0, 0],
      rotY: [0, 0],
      rotZ: [0, 0],
      rotW: [1, 1],
      radii: [1.0, 1.0],
    };

    const result = manager.validateFrame(colFrame);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_HARD_REJECTED);
    expect(result.failingEntityIds).toContain(101);
    expect(result.failingEntityIds).toContain(102);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_COLLISION_PENETRATION)).toBe(true);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_STRICT_REJECTED)).toBe(true);
  });

  it("detects pure out-of-bounds as STATUS_OOB_DETECTED in Debug Mode", () => {
    const oobOnlyFrame: PhysicsFrameSoA = {
      frameId: 22n,
      timestampNs: 22000n,
      deltaTime: 0.016,
      mode: EngineMode.DEBUG,
      entityIds: [77],
      posX: [15000.0],
      posY: [0],
      posZ: [0],
      velX: [0],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };

    const result = manager.validateFrame(oobOnlyFrame);
    expect(result.statusCode).toBe(PhysicsStatusCode.STATUS_OOB_DETECTED);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_OUT_OF_BOUNDS)).toBe(true);
    expect(hasPhysicsError(result.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_STRICT_REJECTED)).toBe(true);
  });

  it("enforces deterministic lockstep sequence verification in Debug Mode", () => {
    manager.configureDebug({ enforceDeterministicLockstep: true });

    const frame1: PhysicsFrameSoA = {
      frameId: 100n,
      timestampNs: 100000000n,
      deltaTime: 0.016,
      mode: EngineMode.DEBUG,
      entityIds: [1],
      posX: [0],
      posY: [0],
      posZ: [0],
      velX: [0],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };
    const res1 = manager.validateFrame(frame1);
    expect(res1.statusCode).toBe(PhysicsStatusCode.STATUS_OK);

    // Frame 2 arrives out-of-order (frameId 99 <= 100)
    const frame2OutOfOrder: PhysicsFrameSoA = {
      frameId: 99n,
      timestampNs: 116000000n,
      deltaTime: 0.016,
      mode: EngineMode.DEBUG,
      entityIds: [1],
      posX: [0],
      posY: [0],
      posZ: [0],
      velX: [0],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };
    const res2 = manager.validateFrame(frame2OutOfOrder);
    expect(res2.statusCode).toBe(PhysicsStatusCode.STATUS_HARD_REJECTED);
    expect(hasPhysicsError(res2.frameErrorBitmask!, PhysicsErrorBitmask.ERROR_STRICT_REJECTED)).toBe(true);
    expect(res2.errorMessage).toContain("Deterministic lockstep violation");
  });

  // ==========================================
  // AUTHORITY MANAGER CONTROL TESTS
  // ==========================================

  it("resets history cleanly with resetHistory()", () => {
    manager.configureDebug({ enforceDeterministicLockstep: true });

    const frame1: PhysicsFrameSoA = {
      frameId: 50n,
      timestampNs: 50000n,
      deltaTime: 0.016,
      mode: EngineMode.DEBUG,
      entityIds: [1],
      posX: [0],
      posY: [0],
      posZ: [0],
      velX: [0],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };
    manager.validateFrame(frame1);

    // Reset history
    manager.resetHistory();

    // Now frameId 10 is accepted because history was wiped
    const frameReset: PhysicsFrameSoA = {
      frameId: 10n,
      timestampNs: 10000n,
      deltaTime: 0.016,
      mode: EngineMode.DEBUG,
      entityIds: [1],
      posX: [0],
      posY: [0],
      posZ: [0],
      velX: [0],
      velY: [0],
      velZ: [0],
      rotX: [0],
      rotY: [0],
      rotZ: [0],
      rotW: [1],
    };
    const res = manager.validateFrame(frameReset);
    expect(res.statusCode).toBe(PhysicsStatusCode.STATUS_OK);
  });
});

