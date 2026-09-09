// Original file: proto/animation_stream.proto

import type { AnimationLayer as _mcp_physics_AnimationLayer, AnimationLayer__Output as _mcp_physics_AnimationLayer__Output } from '../../mcp/physics/AnimationLayer.js';

export interface AnimationIntent {
  'intentName'?: (string);
  'priority'?: (number);
  'desiredVelocity'?: (number | string);
  'intensity'?: (number | string);
  'layer'?: (_mcp_physics_AnimationLayer);
  'priorityTags'?: (string)[];
  'blendTransitionDuration'?: (number | string);
}

export interface AnimationIntent__Output {
  'intentName': (string);
  'priority': (number);
  'desiredVelocity': (number);
  'intensity': (number);
  'layer': (_mcp_physics_AnimationLayer__Output);
  'priorityTags': (string)[];
  'blendTransitionDuration': (number);
}
