import type * as grpc from '@grpc/grpc-js';
import type { EnumTypeDefinition, MessageTypeDefinition } from '@grpc/proto-loader';

import type { PhysicsFrameSoA as _mcp_physics_PhysicsFrameSoA, PhysicsFrameSoA__Output as _mcp_physics_PhysicsFrameSoA__Output } from './mcp/physics/PhysicsFrameSoA.js';
import type { PhysicsStreamingServiceClient as _mcp_physics_PhysicsStreamingServiceClient, PhysicsStreamingServiceDefinition as _mcp_physics_PhysicsStreamingServiceDefinition } from './mcp/physics/PhysicsStreamingService.js';
import type { PhysicsValidationResponse as _mcp_physics_PhysicsValidationResponse, PhysicsValidationResponse__Output as _mcp_physics_PhysicsValidationResponse__Output } from './mcp/physics/PhysicsValidationResponse.js';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  mcp: {
    physics: {
      EngineMode: EnumTypeDefinition
      PhysicsErrorBitmask: EnumTypeDefinition
      PhysicsFrameSoA: MessageTypeDefinition<_mcp_physics_PhysicsFrameSoA, _mcp_physics_PhysicsFrameSoA__Output>
      PhysicsStatusCode: EnumTypeDefinition
      PhysicsStreamingService: SubtypeConstructor<typeof grpc.Client, _mcp_physics_PhysicsStreamingServiceClient> & { service: _mcp_physics_PhysicsStreamingServiceDefinition }
      PhysicsValidationResponse: MessageTypeDefinition<_mcp_physics_PhysicsValidationResponse, _mcp_physics_PhysicsValidationResponse__Output>
    }
  }
}

