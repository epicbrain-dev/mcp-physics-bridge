// Original file: proto/ai_hooks.proto

import type { Long } from '@grpc/proto-loader';

export interface AIHookRequest {
  'hookId'?: (string);
  'eventName'?: (string);
  'targetEntityId'?: (number);
  'frameId'?: (number | string | Long);
  'contextJson'?: (string);
}

export interface AIHookRequest__Output {
  'hookId': (string);
  'eventName': (string);
  'targetEntityId': (number);
  'frameId': (Long);
  'contextJson': (string);
}
