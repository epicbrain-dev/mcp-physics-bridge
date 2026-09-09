// Original file: proto/ai_hooks.proto

import type { DiagnosticTrace as _mcp_physics_DiagnosticTrace, DiagnosticTrace__Output as _mcp_physics_DiagnosticTrace__Output } from '../../mcp/physics/DiagnosticTrace.js';
import type { Long } from '@grpc/proto-loader';

export interface ReflectiveMemoryReport {
  'moduleId'?: (string);
  'astDiff'?: (string);
  'compressedErrorLogs'?: (string);
  'failedFrameId'?: (number | string | Long);
  'diagnosticTrace'?: (_mcp_physics_DiagnosticTrace | null);
}

export interface ReflectiveMemoryReport__Output {
  'moduleId': (string);
  'astDiff': (string);
  'compressedErrorLogs': (string);
  'failedFrameId': (Long);
  'diagnosticTrace': (_mcp_physics_DiagnosticTrace__Output | null);
}
