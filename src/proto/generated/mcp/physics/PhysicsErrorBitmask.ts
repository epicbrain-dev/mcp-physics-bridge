// Original file: proto/physics_stream.proto

export const PhysicsErrorBitmask = {
  ERROR_NONE: 0,
  ERROR_NAN_OR_INF: 1,
  ERROR_OUT_OF_BOUNDS: 2,
  ERROR_LINEAR_VEL_EXCEEDED: 4,
  ERROR_ANGULAR_VEL_EXCEEDED: 8,
  ERROR_ROTATION_UNNORMALIZED: 16,
  ERROR_COLLISION_PENETRATION: 32,
  ERROR_DIVERGENCE_SNAP: 64,
  ERROR_TIME_DILATED: 128,
  ERROR_STRICT_REJECTED: 256,
} as const;

export type PhysicsErrorBitmask =
  | 'ERROR_NONE'
  | 0
  | 'ERROR_NAN_OR_INF'
  | 1
  | 'ERROR_OUT_OF_BOUNDS'
  | 2
  | 'ERROR_LINEAR_VEL_EXCEEDED'
  | 4
  | 'ERROR_ANGULAR_VEL_EXCEEDED'
  | 8
  | 'ERROR_ROTATION_UNNORMALIZED'
  | 16
  | 'ERROR_COLLISION_PENETRATION'
  | 32
  | 'ERROR_DIVERGENCE_SNAP'
  | 64
  | 'ERROR_TIME_DILATED'
  | 128
  | 'ERROR_STRICT_REJECTED'
  | 256

export type PhysicsErrorBitmask__Output = typeof PhysicsErrorBitmask[keyof typeof PhysicsErrorBitmask]
