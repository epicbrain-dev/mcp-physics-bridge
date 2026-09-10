import type * as grpc from '@grpc/grpc-js';
import type { EnumTypeDefinition, MessageTypeDefinition } from '@grpc/proto-loader';

import type { AnimationBlendWeight as _mcp_physics_AnimationBlendWeight, AnimationBlendWeight__Output as _mcp_physics_AnimationBlendWeight__Output } from './mcp/physics/AnimationBlendWeight.js';
import type { AnimationIntent as _mcp_physics_AnimationIntent, AnimationIntent__Output as _mcp_physics_AnimationIntent__Output } from './mcp/physics/AnimationIntent.js';
import type { AnimationSynthesisServiceClient as _mcp_physics_AnimationSynthesisServiceClient, AnimationSynthesisServiceDefinition as _mcp_physics_AnimationSynthesisServiceDefinition } from './mcp/physics/AnimationSynthesisService.js';
import type { SynthesizedAnimationState as _mcp_physics_SynthesizedAnimationState, SynthesizedAnimationState__Output as _mcp_physics_SynthesizedAnimationState__Output } from './mcp/physics/SynthesizedAnimationState.js';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  mcp: {
    physics: {
      AnimationBlendWeight: MessageTypeDefinition<_mcp_physics_AnimationBlendWeight, _mcp_physics_AnimationBlendWeight__Output>
      AnimationIntent: MessageTypeDefinition<_mcp_physics_AnimationIntent, _mcp_physics_AnimationIntent__Output>
      AnimationLayer: EnumTypeDefinition
      AnimationSynthesisService: SubtypeConstructor<typeof grpc.Client, _mcp_physics_AnimationSynthesisServiceClient> & { service: _mcp_physics_AnimationSynthesisServiceDefinition }
      GenreTemplate: EnumTypeDefinition
      SynthesizedAnimationState: MessageTypeDefinition<_mcp_physics_SynthesizedAnimationState, _mcp_physics_SynthesizedAnimationState__Output>
    }
  }
}

