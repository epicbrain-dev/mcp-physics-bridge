import type * as grpc from '@grpc/grpc-js';
import type { EnumTypeDefinition, MessageTypeDefinition } from '@grpc/proto-loader';

import type { AnimationSynthesisServiceClient as _mcp_physics_AnimationSynthesisServiceClient, AnimationSynthesisServiceDefinition as _mcp_physics_AnimationSynthesisServiceDefinition } from './mcp/physics/AnimationSynthesisService.js';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  mcp: {
    physics: {
      AnimationBlendWeight: MessageTypeDefinition
      AnimationIntent: MessageTypeDefinition
      AnimationLayer: EnumTypeDefinition
      AnimationSynthesisService: SubtypeConstructor<typeof grpc.Client, _mcp_physics_AnimationSynthesisServiceClient> & { service: _mcp_physics_AnimationSynthesisServiceDefinition }
      GenreTemplate: EnumTypeDefinition
      SynthesizedAnimationState: MessageTypeDefinition
    }
  }
}

