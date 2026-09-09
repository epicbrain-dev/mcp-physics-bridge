import { Vector3 } from "./vector3";

/**
 * Sandbox-native Quaternion implementation for AssemblyScript.
 * Used for 3D rotations completely within the WebAssembly container.
 */
export class Quaternion {
  public x: f32;
  public y: f32;
  public z: f32;
  public w: f32;

  constructor(x: f32 = 0.0, y: f32 = 0.0, z: f32 = 0.0, w: f32 = 1.0) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  @inline
  static identity(): Quaternion {
    return new Quaternion(0.0, 0.0, 0.0, 1.0);
  }

  @inline
  multiply(q: Quaternion): Quaternion {
    return new Quaternion(
      this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
      this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
      this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w,
      this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z
    );
  }

  @inline
  conjugate(): Quaternion {
    return new Quaternion(-this.x, -this.y, -this.z, this.w);
  }

  @inline
  lengthSquared(): f32 {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  @inline
  length(): f32 {
    return Mathf.sqrt(this.lengthSquared());
  }

  normalize(): Quaternion {
    const len = this.length();
    if (len > 0.00001) {
      const inv: f32 = f32(1.0) / len;
      return new Quaternion(this.x * inv, this.y * inv, this.z * inv, this.w * inv);
    }
    return Quaternion.identity();
  }

  @inline
  dot(q: Quaternion): f32 {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
  }

  @inline
  inverse(): Quaternion {
    const ls = this.lengthSquared();
    if (ls > 0.00001) {
      const inv: f32 = f32(1.0) / ls;
      return new Quaternion(-this.x * inv, -this.y * inv, -this.z * inv, this.w * inv);
    }
    return Quaternion.identity();
  }

  rotateVector(v: Vector3): Vector3 {
    const qv = new Vector3(this.x, this.y, this.z);
    const uv = qv.cross(v);
    const uuv = qv.cross(uv);

    const uvScaled = uv.scale(2.0 * this.w);
    const uuvScaled = uuv.scale(2.0);

    return v.add(uvScaled).add(uuvScaled);
  }

  slerp(target: Quaternion, t: f32): Quaternion {
    let cosHalfTheta = this.dot(target);
    let targetX = target.x;
    let targetY = target.y;
    let targetZ = target.z;
    let targetW = target.w;

    if (cosHalfTheta < 0.0) {
      targetX = -targetX;
      targetY = -targetY;
      targetZ = -targetZ;
      targetW = -targetW;
      cosHalfTheta = -cosHalfTheta;
    }

    if (cosHalfTheta >= f32(1.0) - f32(0.0001)) {
      const res = new Quaternion(
        this.x + (targetX - this.x) * t,
        this.y + (targetY - this.y) * t,
        this.z + (targetZ - this.z) * t,
        this.w + (targetW - this.w) * t
      );
      return res.normalize();
    }

    const halfTheta = Mathf.acos(cosHalfTheta);
    const sinHalfTheta = Mathf.sqrt(f32(1.0) - cosHalfTheta * cosHalfTheta);
    const ratioA = Mathf.sin((f32(1.0) - t) * halfTheta) / sinHalfTheta;
    const ratioB = Mathf.sin(t * halfTheta) / sinHalfTheta;

    return new Quaternion(
      this.x * ratioA + targetX * ratioB,
      this.y * ratioA + targetY * ratioB,
      this.z * ratioA + targetZ * ratioB,
      this.w * ratioA + targetW * ratioB
    );
  }

  @inline
  clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }

  @inline
  equals(q: Quaternion, tolerance: f32 = 0.0001): bool {
    return (
      Mathf.abs(this.x - q.x) <= tolerance &&
      Mathf.abs(this.y - q.y) <= tolerance &&
      Mathf.abs(this.z - q.z) <= tolerance &&
      Mathf.abs(this.w - q.w) <= tolerance
    );
  }

  static fromAxisAngle(axis: Vector3, rad: f32): Quaternion {
    const halfAngle = rad * 0.5;
    const s = Mathf.sin(halfAngle);
    const normAxis = axis.normalize();
    return new Quaternion(
      normAxis.x * s,
      normAxis.y * s,
      normAxis.z * s,
      Mathf.cos(halfAngle)
    );
  }

  static fromEuler(pitch: f32, yaw: f32, roll: f32): Quaternion {
    const c1 = Mathf.cos(pitch * 0.5);
    const s1 = Mathf.sin(pitch * 0.5);
    const c2 = Mathf.cos(yaw * 0.5);
    const s2 = Mathf.sin(yaw * 0.5);
    const c3 = Mathf.cos(roll * 0.5);
    const s3 = Mathf.sin(roll * 0.5);

    return new Quaternion(
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 + s1 * s2 * c3,
      c1 * c2 * c3 - s1 * s2 * s3
    );
  }
}
