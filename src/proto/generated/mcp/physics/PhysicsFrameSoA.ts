// Original file: proto/physics_stream.proto

import type { EngineMode as _mcp_physics_EngineMode, EngineMode__Output as _mcp_physics_EngineMode__Output } from '../../mcp/physics/EngineMode.js';
import type { Long } from '@grpc/proto-loader';

export interface PhysicsFrameSoA {
  'frameId'?: (number | string | Long);
  'timestampNs'?: (number | string | Long);
  'deltaTime'?: (number | string);
  'mode'?: (_mcp_physics_EngineMode);
  'entityIds'?: (number)[];
  'posX'?: (number | string)[];
  'posY'?: (number | string)[];
  'posZ'?: (number | string)[];
  'velX'?: (number | string)[];
  'velY'?: (number | string)[];
  'velZ'?: (number | string)[];
  'rotX'?: (number | string)[];
  'rotY'?: (number | string)[];
  'rotZ'?: (number | string)[];
  'rotW'?: (number | string)[];
  'angVelX'?: (number | string)[];
  'angVelY'?: (number | string)[];
  'angVelZ'?: (number | string)[];
  'radii'?: (number | string)[];
  'masses'?: (number | string)[];
  'parentIds'?: (number)[];
}

export interface PhysicsFrameSoA__Output {
  'frameId': (Long);
  'timestampNs': (Long);
  'deltaTime': (number);
  'mode': (_mcp_physics_EngineMode__Output);
  'entityIds': (number)[];
  'posX': (number)[];
  'posY': (number)[];
  'posZ': (number)[];
  'velX': (number)[];
  'velY': (number)[];
  'velZ': (number)[];
  'rotX': (number)[];
  'rotY': (number)[];
  'rotZ': (number)[];
  'rotW': (number)[];
  'angVelX': (number)[];
  'angVelY': (number)[];
  'angVelZ': (number)[];
  'radii': (number)[];
  'masses': (number)[];
  'parentIds': (number)[];
}
