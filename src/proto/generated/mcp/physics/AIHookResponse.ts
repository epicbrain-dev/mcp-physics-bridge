// Original file: proto/ai_hooks.proto

import type { DualPayloadModule as _mcp_physics_DualPayloadModule, DualPayloadModule__Output as _mcp_physics_DualPayloadModule__Output } from '../../mcp/physics/DualPayloadModule.js';
import type { DiagnosticTrace as _mcp_physics_DiagnosticTrace, DiagnosticTrace__Output as _mcp_physics_DiagnosticTrace__Output } from '../../mcp/physics/DiagnosticTrace.js';

export interface AIHookResponse {
  'hookId'?: (string);
  'success'?: (boolean);
  'executionResultJson'?: (string);
  'deployedModule'?: (_mcp_physics_DualPayloadModule | null);
  'errorMessage'?: (string);
  'diagnosticTrace'?: (_mcp_physics_DiagnosticTrace | null);
}

export interface AIHookResponse__Output {
  'hookId': (string);
  'success': (boolean);
  'executionResultJson': (string);
  'deployedModule': (_mcp_physics_DualPayloadModule__Output | null);
  'errorMessage': (string);
  'diagnosticTrace': (_mcp_physics_DiagnosticTrace__Output | null);
}
