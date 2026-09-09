// Original file: proto/ai_hooks.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { AIHookRequest as _mcp_physics_AIHookRequest, AIHookRequest__Output as _mcp_physics_AIHookRequest__Output } from '../../mcp/physics/AIHookRequest.js';
import type { AIHookResponse as _mcp_physics_AIHookResponse, AIHookResponse__Output as _mcp_physics_AIHookResponse__Output } from '../../mcp/physics/AIHookResponse.js';
import type { DualPayloadModule as _mcp_physics_DualPayloadModule, DualPayloadModule__Output as _mcp_physics_DualPayloadModule__Output } from '../../mcp/physics/DualPayloadModule.js';
import type { ReflectiveMemoryReport as _mcp_physics_ReflectiveMemoryReport, ReflectiveMemoryReport__Output as _mcp_physics_ReflectiveMemoryReport__Output } from '../../mcp/physics/ReflectiveMemoryReport.js';

export interface AIHookServiceClient extends grpc.Client {
  DeployLogicModule(argument: _mcp_physics_DualPayloadModule, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  DeployLogicModule(argument: _mcp_physics_DualPayloadModule, metadata: grpc.Metadata, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  DeployLogicModule(argument: _mcp_physics_DualPayloadModule, options: grpc.CallOptions, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  DeployLogicModule(argument: _mcp_physics_DualPayloadModule, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  deployLogicModule(argument: _mcp_physics_DualPayloadModule, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  deployLogicModule(argument: _mcp_physics_DualPayloadModule, metadata: grpc.Metadata, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  deployLogicModule(argument: _mcp_physics_DualPayloadModule, options: grpc.CallOptions, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  deployLogicModule(argument: _mcp_physics_DualPayloadModule, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  
  ReportReflectiveFailure(argument: _mcp_physics_ReflectiveMemoryReport, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  ReportReflectiveFailure(argument: _mcp_physics_ReflectiveMemoryReport, metadata: grpc.Metadata, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  ReportReflectiveFailure(argument: _mcp_physics_ReflectiveMemoryReport, options: grpc.CallOptions, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  ReportReflectiveFailure(argument: _mcp_physics_ReflectiveMemoryReport, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  reportReflectiveFailure(argument: _mcp_physics_ReflectiveMemoryReport, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  reportReflectiveFailure(argument: _mcp_physics_ReflectiveMemoryReport, metadata: grpc.Metadata, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  reportReflectiveFailure(argument: _mcp_physics_ReflectiveMemoryReport, options: grpc.CallOptions, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  reportReflectiveFailure(argument: _mcp_physics_ReflectiveMemoryReport, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  
  TriggerAIHook(argument: _mcp_physics_AIHookRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  TriggerAIHook(argument: _mcp_physics_AIHookRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  TriggerAIHook(argument: _mcp_physics_AIHookRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  TriggerAIHook(argument: _mcp_physics_AIHookRequest, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  triggerAiHook(argument: _mcp_physics_AIHookRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  triggerAiHook(argument: _mcp_physics_AIHookRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  triggerAiHook(argument: _mcp_physics_AIHookRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  triggerAiHook(argument: _mcp_physics_AIHookRequest, callback: grpc.requestCallback<_mcp_physics_AIHookResponse__Output>): grpc.ClientUnaryCall;
  
}

export interface AIHookServiceHandlers extends grpc.UntypedServiceImplementation {
  DeployLogicModule: grpc.handleUnaryCall<_mcp_physics_DualPayloadModule__Output, _mcp_physics_AIHookResponse>;
  
  ReportReflectiveFailure: grpc.handleUnaryCall<_mcp_physics_ReflectiveMemoryReport__Output, _mcp_physics_AIHookResponse>;
  
  TriggerAIHook: grpc.handleUnaryCall<_mcp_physics_AIHookRequest__Output, _mcp_physics_AIHookResponse>;
  
}

export interface AIHookServiceDefinition extends grpc.ServiceDefinition {
  DeployLogicModule: MethodDefinition<_mcp_physics_DualPayloadModule, _mcp_physics_AIHookResponse, _mcp_physics_DualPayloadModule__Output, _mcp_physics_AIHookResponse__Output>
  ReportReflectiveFailure: MethodDefinition<_mcp_physics_ReflectiveMemoryReport, _mcp_physics_AIHookResponse, _mcp_physics_ReflectiveMemoryReport__Output, _mcp_physics_AIHookResponse__Output>
  TriggerAIHook: MethodDefinition<_mcp_physics_AIHookRequest, _mcp_physics_AIHookResponse, _mcp_physics_AIHookRequest__Output, _mcp_physics_AIHookResponse__Output>
}
