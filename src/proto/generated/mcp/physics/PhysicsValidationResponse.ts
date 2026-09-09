// Original file: proto/physics_stream.proto

import type { PhysicsStatusCode as _mcp_physics_PhysicsStatusCode, PhysicsStatusCode__Output as _mcp_physics_PhysicsStatusCode__Output } from '../../mcp/physics/PhysicsStatusCode.js';
import type { PhysicsFrameSoA as _mcp_physics_PhysicsFrameSoA, PhysicsFrameSoA__Output as _mcp_physics_PhysicsFrameSoA__Output } from '../../mcp/physics/PhysicsFrameSoA.js';
import type { Long } from '@grpc/proto-loader';

export interface PhysicsValidationResponse {
  'frameId'?: (number | string | Long);
  'statusCode'?: (_mcp_physics_PhysicsStatusCode);
  'errorMessage'?: (string);
  'correctedFrame'?: (_mcp_physics_PhysicsFrameSoA | null);
  'failingEntityIds'?: (number)[];
  'frameErrorBitmask'?: (number);
  'entityErrorBitmasks'?: (number)[];
}

export interface PhysicsValidationResponse__Output {
  'frameId': (Long);
  'statusCode': (_mcp_physics_PhysicsStatusCode__Output);
  'errorMessage': (string);
  'correctedFrame': (_mcp_physics_PhysicsFrameSoA__Output | null);
  'failingEntityIds': (number)[];
  'frameErrorBitmask': (number);
  'entityErrorBitmasks': (number)[];
}
