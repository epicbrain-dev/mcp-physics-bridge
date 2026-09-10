import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { AIHookRequest as _mcp_physics_AIHookRequest, AIHookRequest__Output as _mcp_physics_AIHookRequest__Output } from './mcp/physics/AIHookRequest.js';
import type { AIHookResponse as _mcp_physics_AIHookResponse, AIHookResponse__Output as _mcp_physics_AIHookResponse__Output } from './mcp/physics/AIHookResponse.js';
import type { AIHookServiceClient as _mcp_physics_AIHookServiceClient, AIHookServiceDefinition as _mcp_physics_AIHookServiceDefinition } from './mcp/physics/AIHookService.js';
import type { DiagnosticTrace as _mcp_physics_DiagnosticTrace, DiagnosticTrace__Output as _mcp_physics_DiagnosticTrace__Output } from './mcp/physics/DiagnosticTrace.js';
import type { DualPayloadModule as _mcp_physics_DualPayloadModule, DualPayloadModule__Output as _mcp_physics_DualPayloadModule__Output } from './mcp/physics/DualPayloadModule.js';
import type { ReflectiveMemoryReport as _mcp_physics_ReflectiveMemoryReport, ReflectiveMemoryReport__Output as _mcp_physics_ReflectiveMemoryReport__Output } from './mcp/physics/ReflectiveMemoryReport.js';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  mcp: {
    physics: {
      AIHookRequest: MessageTypeDefinition<_mcp_physics_AIHookRequest, _mcp_physics_AIHookRequest__Output>
      AIHookResponse: MessageTypeDefinition<_mcp_physics_AIHookResponse, _mcp_physics_AIHookResponse__Output>
      AIHookService: SubtypeConstructor<typeof grpc.Client, _mcp_physics_AIHookServiceClient> & { service: _mcp_physics_AIHookServiceDefinition }
      DiagnosticTrace: MessageTypeDefinition<_mcp_physics_DiagnosticTrace, _mcp_physics_DiagnosticTrace__Output>
      DualPayloadModule: MessageTypeDefinition<_mcp_physics_DualPayloadModule, _mcp_physics_DualPayloadModule__Output>
      ReflectiveMemoryReport: MessageTypeDefinition<_mcp_physics_ReflectiveMemoryReport, _mcp_physics_ReflectiveMemoryReport__Output>
    }
  }
}

