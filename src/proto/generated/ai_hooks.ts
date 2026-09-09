import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { AIHookServiceClient as _mcp_physics_AIHookServiceClient, AIHookServiceDefinition as _mcp_physics_AIHookServiceDefinition } from './mcp/physics/AIHookService.js';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  mcp: {
    physics: {
      AIHookRequest: MessageTypeDefinition
      AIHookResponse: MessageTypeDefinition
      AIHookService: SubtypeConstructor<typeof grpc.Client, _mcp_physics_AIHookServiceClient> & { service: _mcp_physics_AIHookServiceDefinition }
      DiagnosticTrace: MessageTypeDefinition
      DualPayloadModule: MessageTypeDefinition
      ReflectiveMemoryReport: MessageTypeDefinition
    }
  }
}

