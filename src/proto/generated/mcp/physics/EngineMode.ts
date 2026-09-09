// Original file: proto/physics_stream.proto

export const EngineMode = {
  PLAYTEST: 0,
  DEBUG: 1,
} as const;

export type EngineMode =
  | 'PLAYTEST'
  | 0
  | 'DEBUG'
  | 1

export type EngineMode__Output = typeof EngineMode[keyof typeof EngineMode]
