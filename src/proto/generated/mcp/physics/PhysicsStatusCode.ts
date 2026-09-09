// Original file: proto/physics_stream.proto

export const PhysicsStatusCode = {
  STATUS_OK: 0,
  STATUS_SOFT_CLAMPED: 1,
  STATUS_TIME_DILATED: 2,
  STATUS_VFX_SNAP_TRIGGERED: 3,
  STATUS_HARD_REJECTED: 4,
  STATUS_NAN_DETECTED: 5,
  STATUS_OOB_DETECTED: 6,
} as const;

export type PhysicsStatusCode =
  | 'STATUS_OK'
  | 0
  | 'STATUS_SOFT_CLAMPED'
  | 1
  | 'STATUS_TIME_DILATED'
  | 2
  | 'STATUS_VFX_SNAP_TRIGGERED'
  | 3
  | 'STATUS_HARD_REJECTED'
  | 4
  | 'STATUS_NAN_DETECTED'
  | 5
  | 'STATUS_OOB_DETECTED'
  | 6

export type PhysicsStatusCode__Output = typeof PhysicsStatusCode[keyof typeof PhysicsStatusCode]
