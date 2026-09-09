// Original file: proto/ai_hooks.proto


export interface DualPayloadModule {
  'moduleId'?: (string);
  'assemblyscriptSource'?: (string);
  'wasmBytecode'?: (Buffer | Uint8Array | string);
  'sourceChecksum'?: (string);
  'compilerVersion'?: (string);
  'optimizationTarget'?: (string);
}

export interface DualPayloadModule__Output {
  'moduleId': (string);
  'assemblyscriptSource': (string);
  'wasmBytecode': (Buffer);
  'sourceChecksum': (string);
  'compilerVersion': (string);
  'optimizationTarget': (string);
}
