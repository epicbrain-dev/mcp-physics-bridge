import type * as grpc from '@grpc/grpc-js';
import type { EnumTypeDefinition, MessageTypeDefinition } from '@grpc/proto-loader';

import type { PhysicsStreamingServiceClient as _mcp_physics_PhysicsStreamingServiceClient, PhysicsStreamingServiceDefinition as _mcp_physics_PhysicsStreamingServiceDefinition } from './mcp/physics/PhysicsStreamingService.js';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  mcp: {
    physics: {
      EngineMode: EnumTypeDefinition
      PhysicsErrorBitmask: EnumTypeDefinition
      PhysicsFrameSoA: MessageTypeDefinition
      PhysicsStatusCode: EnumTypeDefinition
      PhysicsStreamingService: SubtypeConstructor<typeof grpc.Client, _mcp_physics_PhysicsStreamingServiceClient> & { service: _mcp_physics_PhysicsStreamingServiceDefinition }
      PhysicsValidationResponse: MessageTypeDefinition
    }
  }
}

