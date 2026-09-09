// Original file: proto/animation_stream.proto

import type { AnimationBlendWeight as _mcp_physics_AnimationBlendWeight, AnimationBlendWeight__Output as _mcp_physics_AnimationBlendWeight__Output } from '../../mcp/physics/AnimationBlendWeight.js';
import type { AnimationLayer as _mcp_physics_AnimationLayer, AnimationLayer__Output as _mcp_physics_AnimationLayer__Output } from '../../mcp/physics/AnimationLayer.js';
import type { Long } from '@grpc/proto-loader';

export interface SynthesizedAnimationState {
  'entityId'?: (number);
  'frameId'?: (number | string | Long);
  'activeIntent'?: (string);
  'blendWeights'?: (_mcp_physics_AnimationBlendWeight)[];
  'playbackScale'?: (number | string);
  'arbitrationPreempted'?: (boolean);
  'preemptedReason'?: (string);
  'layer'?: (_mcp_physics_AnimationLayer);
}

export interface SynthesizedAnimationState__Output {
  'entityId': (number);
  'frameId': (Long);
  'activeIntent': (string);
  'blendWeights': (_mcp_physics_AnimationBlendWeight__Output)[];
  'playbackScale': (number);
  'arbitrationPreempted': (boolean);
  'preemptedReason': (string);
  'layer': (_mcp_physics_AnimationLayer__Output);
}
