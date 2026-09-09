// Original file: proto/ai_hooks.proto

import type { Long } from '@grpc/proto-loader';

export interface DiagnosticTrace {
  'executionTimeNs'?: (number | string | Long);
  'compileTimeNs'?: (number | string | Long);
  'memoryBytesUsed'?: (number);
  'instructionsExecuted'?: (number | string | Long);
  'cacheHit'?: (boolean);
  'sandboxExitCode'?: (number);
  'consoleLogs'?: (string)[];
  'callStack'?: (string);
  'errorCategory'?: (string);
}

export interface DiagnosticTrace__Output {
  'executionTimeNs': (Long);
  'compileTimeNs': (Long);
  'memoryBytesUsed': (number);
  'instructionsExecuted': (Long);
  'cacheHit': (boolean);
  'sandboxExitCode': (number);
  'consoleLogs': (string)[];
  'callStack': (string);
  'errorCategory': (string);
}
