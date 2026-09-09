import { Vector3 } from "./math/vector3";
import { Quaternion } from "./math/quaternion";
// Vector3 and Quaternion are bundled internal math classes for in-sandbox logic.
// WebAssembly binary modules export flat functions, variables, and memories.
/**
 * Example sandboxed physics step invoked from the host via WebAssembly export.
 */
export function calculateVelocity(currentVel: f32, force: f32, mass: f32, dt: f32): f32 {
  if (mass <= 0.0) return currentVel;
  const acceleration = force / mass;
  return currentVel + acceleration * dt;
}

export function clampVelocity(vel: f32, maxVel: f32): f32 {
  if (vel > maxVel) return maxVel;
  if (vel < -maxVel) return -maxVel;
  return vel;
}

export function integrate1D(pos: f32, vel: f32, dt: f32): f32 {
  return pos + vel * dt;
}

export function vector3_dot(x1: f32, y1: f32, z1: f32, x2: f32, y2: f32, z2: f32): f32 {
  const v1 = new Vector3(x1, y1, z1);
  const v2 = new Vector3(x2, y2, z2);
  return v1.dot(v2);
}

export function vector3_distance(x1: f32, y1: f32, z1: f32, x2: f32, y2: f32, z2: f32): f32 {
  const v1 = new Vector3(x1, y1, z1);
  const v2 = new Vector3(x2, y2, z2);
  return v1.distance(v2);
}

export function vector3_length(x: f32, y: f32, z: f32): f32 {
  const v = new Vector3(x, y, z);
  return v.length();
}

export function quaternion_rotateVector_x(
  qx: f32, qy: f32, qz: f32, qw: f32,
  vx: f32, vy: f32, vz: f32
): f32 {
  const q = new Quaternion(qx, qy, qz, qw);
  const v = new Vector3(vx, vy, vz);
  return q.rotateVector(v).x;
}

export function quaternion_rotateVector_y(
  qx: f32, qy: f32, qz: f32, qw: f32,
  vx: f32, vy: f32, vz: f32
): f32 {
  const q = new Quaternion(qx, qy, qz, qw);
  const v = new Vector3(vx, vy, vz);
  return q.rotateVector(v).y;
}

export function quaternion_rotateVector_z(
  qx: f32, qy: f32, qz: f32, qw: f32,
  vx: f32, vy: f32, vz: f32
): f32 {
  const q = new Quaternion(qx, qy, qz, qw);
  const v = new Vector3(vx, vy, vz);
  return q.rotateVector(v).z;
}

export function step_euler(pos: f32, vel: f32, force: f32, mass: f32, dt: f32): f32 {
  const newVel = calculateVelocity(vel, force, mass, dt);
  return integrate1D(pos, newVel, dt);
}
