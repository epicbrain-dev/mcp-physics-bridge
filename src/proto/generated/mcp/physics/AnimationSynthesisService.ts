// Original file: proto/animation_stream.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { AnimationIntent as _mcp_physics_AnimationIntent, AnimationIntent__Output as _mcp_physics_AnimationIntent__Output } from '../../mcp/physics/AnimationIntent.js';
import type { SynthesizedAnimationState as _mcp_physics_SynthesizedAnimationState, SynthesizedAnimationState__Output as _mcp_physics_SynthesizedAnimationState__Output } from '../../mcp/physics/SynthesizedAnimationState.js';

export interface AnimationSynthesisServiceClient extends grpc.Client {
  StreamAnimationWeights(metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientDuplexStream<_mcp_physics_AnimationIntent, _mcp_physics_SynthesizedAnimationState__Output>;
  StreamAnimationWeights(options?: grpc.CallOptions): grpc.ClientDuplexStream<_mcp_physics_AnimationIntent, _mcp_physics_SynthesizedAnimationState__Output>;
  streamAnimationWeights(metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientDuplexStream<_mcp_physics_AnimationIntent, _mcp_physics_SynthesizedAnimationState__Output>;
  streamAnimationWeights(options?: grpc.CallOptions): grpc.ClientDuplexStream<_mcp_physics_AnimationIntent, _mcp_physics_SynthesizedAnimationState__Output>;
  
}

export interface AnimationSynthesisServiceHandlers extends grpc.UntypedServiceImplementation {
  StreamAnimationWeights: grpc.handleBidiStreamingCall<_mcp_physics_AnimationIntent__Output, _mcp_physics_SynthesizedAnimationState>;
  
}

export interface AnimationSynthesisServiceDefinition extends grpc.ServiceDefinition {
  StreamAnimationWeights: MethodDefinition<_mcp_physics_AnimationIntent, _mcp_physics_SynthesizedAnimationState, _mcp_physics_AnimationIntent__Output, _mcp_physics_SynthesizedAnimationState__Output>
}
