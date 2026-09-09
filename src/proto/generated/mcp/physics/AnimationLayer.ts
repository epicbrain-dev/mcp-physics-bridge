// Original file: proto/animation_stream.proto

export const AnimationLayer = {
  LAYER_FULL_BODY: 0,
  LAYER_LOWER_BODY: 1,
  LAYER_UPPER_BODY: 2,
  LAYER_ADDITIVE: 3,
} as const;

export type AnimationLayer =
  | 'LAYER_FULL_BODY'
  | 0
  | 'LAYER_LOWER_BODY'
  | 1
  | 'LAYER_UPPER_BODY'
  | 2
  | 'LAYER_ADDITIVE'
  | 3

export type AnimationLayer__Output = typeof AnimationLayer[keyof typeof AnimationLayer]
