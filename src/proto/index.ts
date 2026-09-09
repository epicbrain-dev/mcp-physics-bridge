// Re-export proto-loader ProtoGrpcType definitions with unique aliases
export type { ProtoGrpcType as PhysicsStreamProtoGrpcType } from "./generated/physics_stream.js";
export type { ProtoGrpcType as AIHooksProtoGrpcType } from "./generated/ai_hooks.js";
export type { ProtoGrpcType as AnimationStreamProtoGrpcType } from "./generated/animation_stream.js";

// Re-export generated enums and bitmasks
import { EngineMode as EngineModeConst } from "./generated/mcp/physics/EngineMode.js";
import { PhysicsStatusCode as PhysicsStatusCodeConst } from "./generated/mcp/physics/PhysicsStatusCode.js";
import { PhysicsErrorBitmask as PhysicsErrorBitmaskConst } from "./generated/mcp/physics/PhysicsErrorBitmask.js";
import { AnimationLayer as AnimationLayerConst } from "./generated/mcp/physics/AnimationLayer.js";
import { GenreTemplate as GenreTemplateConst } from "./generated/mcp/physics/GenreTemplate.js";

export const EngineMode = EngineModeConst;
export type EngineMode = (typeof EngineModeConst)[keyof typeof EngineModeConst];

export const PhysicsStatusCode = PhysicsStatusCodeConst;
export type PhysicsStatusCode = (typeof PhysicsStatusCodeConst)[keyof typeof PhysicsStatusCodeConst];

export const PhysicsErrorBitmask = PhysicsErrorBitmaskConst;
export type PhysicsErrorBitmask = (typeof PhysicsErrorBitmaskConst)[keyof typeof PhysicsErrorBitmaskConst];

export const AnimationLayer = AnimationLayerConst;
export type AnimationLayer = (typeof AnimationLayerConst)[keyof typeof AnimationLayerConst];

export const GenreTemplate = GenreTemplateConst;
export type GenreTemplate = (typeof GenreTemplateConst)[keyof typeof GenreTemplateConst];

// Re-export proto-loader generated message types
export type {
  PhysicsFrameSoA as ProtoPhysicsFrameSoA,
  PhysicsFrameSoA__Output as ProtoPhysicsFrameSoA__Output,
} from "./generated/mcp/physics/PhysicsFrameSoA.js";
export type {
  PhysicsValidationResponse as ProtoPhysicsValidationResponse,
  PhysicsValidationResponse__Output as ProtoPhysicsValidationResponse__Output,
} from "./generated/mcp/physics/PhysicsValidationResponse.js";
export type {
  AIHookRequest as ProtoAIHookRequest,
  AIHookRequest__Output as ProtoAIHookRequest__Output,
} from "./generated/mcp/physics/AIHookRequest.js";
export type {
  AIHookResponse as ProtoAIHookResponse,
  AIHookResponse__Output as ProtoAIHookResponse__Output,
} from "./generated/mcp/physics/AIHookResponse.js";
export type {
  DualPayloadModule as ProtoDualPayloadModule,
  DualPayloadModule__Output as ProtoDualPayloadModule__Output,
} from "./generated/mcp/physics/DualPayloadModule.js";
export type {
  DiagnosticTrace as ProtoDiagnosticTrace,
  DiagnosticTrace__Output as ProtoDiagnosticTrace__Output,
} from "./generated/mcp/physics/DiagnosticTrace.js";
export type {
  ReflectiveMemoryReport as ProtoReflectiveMemoryReport,
  ReflectiveMemoryReport__Output as ProtoReflectiveMemoryReport__Output,
} from "./generated/mcp/physics/ReflectiveMemoryReport.js";
export type {
  AnimationIntent as ProtoAnimationIntent,
  AnimationIntent__Output as ProtoAnimationIntent__Output,
} from "./generated/mcp/physics/AnimationIntent.js";
export type {
  AnimationBlendWeight as ProtoAnimationBlendWeight,
  AnimationBlendWeight__Output as ProtoAnimationBlendWeight__Output,
} from "./generated/mcp/physics/AnimationBlendWeight.js";
export type {
  SynthesizedAnimationState as ProtoSynthesizedAnimationState,
  SynthesizedAnimationState__Output as ProtoSynthesizedAnimationState__Output,
} from "./generated/mcp/physics/SynthesizedAnimationState.js";

// Ergonomic in-memory TypeScript interfaces supporting TypedArrays and 64-bit BigInt
export interface PhysicsFrameSoA {
  frameId: bigint;
  timestampNs: bigint;
  deltaTime: number;
  mode: EngineMode;
  entityIds: Uint32Array | number[];
  parentIds?: Uint32Array | number[];
  posX: Float32Array | number[];
  posY: Float32Array | number[];
  posZ: Float32Array | number[];
  velX: Float32Array | number[];
  velY: Float32Array | number[];
  velZ: Float32Array | number[];
  rotX: Float32Array | number[];
  rotY: Float32Array | number[];
  rotZ: Float32Array | number[];
  rotW: Float32Array | number[];
  angVelX?: Float32Array | number[];
  angVelY?: Float32Array | number[];
  angVelZ?: Float32Array | number[];
  radii?: Float32Array | number[];
  masses?: Float32Array | number[];
}

export interface PhysicsValidationResponse {
  frameId: bigint;
  statusCode: PhysicsStatusCode;
  errorMessage?: string;
  correctedFrame?: PhysicsFrameSoA;
  failingEntityIds?: number[];
  frameErrorBitmask?: number;
  entityErrorBitmasks?: number[];
}

export interface DiagnosticTrace {
  executionTimeNs?: bigint;
  compileTimeNs?: bigint;
  memoryBytesUsed?: number;
  instructionsExecuted?: bigint;
  cacheHit?: boolean;
  sandboxExitCode?: number;
  consoleLogs?: string[];
  callStack?: string;
  errorCategory?: string;
}

export interface DualPayloadModule {
  moduleId: string;
  assemblyscriptSource: string;
  wasmBytecode: Uint8Array;
  sourceChecksum: string;
  compilerVersion?: string;
  optimizationTarget?: string;
}

export interface AIHookRequest {
  hookId: string;
  eventName: string;
  targetEntityId: number;
  frameId: bigint;
  contextJson: string;
}

export interface AIHookResponse {
  hookId: string;
  success: boolean;
  executionResultJson?: string;
  deployedModule?: DualPayloadModule;
  errorMessage?: string;
  diagnosticTrace?: DiagnosticTrace;
}

export interface ReflectiveMemoryReport {
  moduleId: string;
  astDiff: string;
  compressedErrorLogs: string;
  failedFrameId: bigint;
  diagnosticTrace?: DiagnosticTrace;
}

export interface AnimationIntent {
  intentName: string;
  priority: number;
  desiredVelocity: number;
  intensity: number;
  layer?: AnimationLayer;
  priorityTags?: string[];
  blendTransitionDuration?: number;
}

export interface AnimationBlendWeight {
  clipName: string;
  weight: number;
}

export interface SynthesizedAnimationState {
  entityId: number;
  frameId: bigint;
  activeIntent: string;
  blendWeights: AnimationBlendWeight[];
  playbackScale: number;
  arbitrationPreempted: boolean;
  preemptedReason?: string;
  layer?: AnimationLayer;
}

// Bitmask helper functions
export function hasPhysicsError(bitmask: number, errorFlag: number): boolean {
  return (bitmask & errorFlag) === errorFlag && errorFlag !== 0;
}

export function addPhysicsError(bitmask: number, errorFlag: number): number {
  return bitmask | errorFlag;
}

export function formatPhysicsErrors(bitmask: number): string[] {
  if (bitmask === 0) return ["NONE"];
  const errors: string[] = [];
  if (hasPhysicsError(bitmask, PhysicsErrorBitmask.ERROR_NAN_OR_INF)) errors.push("NAN_OR_INF");
  if (hasPhysicsError(bitmask, PhysicsErrorBitmask.ERROR_OUT_OF_BOUNDS)) errors.push("OUT_OF_BOUNDS");
  if (hasPhysicsError(bitmask, PhysicsErrorBitmask.ERROR_LINEAR_VEL_EXCEEDED)) errors.push("LINEAR_VEL_EXCEEDED");
  if (hasPhysicsError(bitmask, PhysicsErrorBitmask.ERROR_ANGULAR_VEL_EXCEEDED)) errors.push("ANGULAR_VEL_EXCEEDED");
  if (hasPhysicsError(bitmask, PhysicsErrorBitmask.ERROR_ROTATION_UNNORMALIZED)) errors.push("ROTATION_UNNORMALIZED");
  if (hasPhysicsError(bitmask, PhysicsErrorBitmask.ERROR_COLLISION_PENETRATION)) errors.push("COLLISION_PENETRATION");
  if (hasPhysicsError(bitmask, PhysicsErrorBitmask.ERROR_DIVERGENCE_SNAP)) errors.push("DIVERGENCE_SNAP");
  if (hasPhysicsError(bitmask, PhysicsErrorBitmask.ERROR_TIME_DILATED)) errors.push("TIME_DILATED");
  if (hasPhysicsError(bitmask, PhysicsErrorBitmask.ERROR_STRICT_REJECTED)) errors.push("STRICT_REJECTED");
  return errors;
}
