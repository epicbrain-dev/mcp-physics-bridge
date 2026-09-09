// Original file: proto/physics_stream.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { PhysicsFrameSoA as _mcp_physics_PhysicsFrameSoA, PhysicsFrameSoA__Output as _mcp_physics_PhysicsFrameSoA__Output } from '../../mcp/physics/PhysicsFrameSoA.js';
import type { PhysicsValidationResponse as _mcp_physics_PhysicsValidationResponse, PhysicsValidationResponse__Output as _mcp_physics_PhysicsValidationResponse__Output } from '../../mcp/physics/PhysicsValidationResponse.js';

export interface PhysicsStreamingServiceClient extends grpc.Client {
  StreamPhysics(metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientDuplexStream<_mcp_physics_PhysicsFrameSoA, _mcp_physics_PhysicsValidationResponse__Output>;
  StreamPhysics(options?: grpc.CallOptions): grpc.ClientDuplexStream<_mcp_physics_PhysicsFrameSoA, _mcp_physics_PhysicsValidationResponse__Output>;
  streamPhysics(metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientDuplexStream<_mcp_physics_PhysicsFrameSoA, _mcp_physics_PhysicsValidationResponse__Output>;
  streamPhysics(options?: grpc.CallOptions): grpc.ClientDuplexStream<_mcp_physics_PhysicsFrameSoA, _mcp_physics_PhysicsValidationResponse__Output>;
  
}

export interface PhysicsStreamingServiceHandlers extends grpc.UntypedServiceImplementation {
  StreamPhysics: grpc.handleBidiStreamingCall<_mcp_physics_PhysicsFrameSoA__Output, _mcp_physics_PhysicsValidationResponse>;
  
}

export interface PhysicsStreamingServiceDefinition extends grpc.ServiceDefinition {
  StreamPhysics: MethodDefinition<_mcp_physics_PhysicsFrameSoA, _mcp_physics_PhysicsValidationResponse, _mcp_physics_PhysicsFrameSoA__Output, _mcp_physics_PhysicsValidationResponse__Output>
}
