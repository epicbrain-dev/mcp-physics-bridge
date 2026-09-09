/**
 * Sandbox-native Vector3 implementation for AssemblyScript.
 * Avoids expensive context switches between WebAssembly and host JavaScript.
 */
export class Vector3 {
  public x: f32;
  public y: f32;
  public z: f32;

  constructor(x: f32 = 0.0, y: f32 = 0.0, z: f32 = 0.0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  @inline
  set(x: f32, y: f32, z: f32): Vector3 {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  @inline
  add(v: Vector3): Vector3 {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  @inline
  subtract(v: Vector3): Vector3 {
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  @inline
  scale(scalar: f32): Vector3 {
    return new Vector3(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  @inline
  dot(v: Vector3): f32 {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  @inline
  cross(v: Vector3): Vector3 {
    return new Vector3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  @inline
  lengthSquared(): f32 {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  @inline
  length(): f32 {
    return Mathf.sqrt(this.lengthSquared());
  }

  @inline
  multiply(v: Vector3): Vector3 {
    return new Vector3(this.x * v.x, this.y * v.y, this.z * v.z);
  }

  @inline
  divide(scalar: f32): Vector3 {
    const inv: f32 = f32(1.0) / scalar;
    return new Vector3(this.x * inv, this.y * inv, this.z * inv);
  }

  @inline
  negate(): Vector3 {
    return new Vector3(-this.x, -this.y, -this.z);
  }

  @inline
  distanceSquared(v: Vector3): f32 {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  @inline
  distance(v: Vector3): f32 {
    return Mathf.sqrt(this.distanceSquared(v));
  }

  normalize(): Vector3 {
    const len = this.length();
    if (len > 0.00001) {
      const inv: f32 = f32(1.0) / len;
      return new Vector3(this.x * inv, this.y * inv, this.z * inv);
    }
    return new Vector3(0.0, 0.0, 0.0);
  }

  @inline
  lerp(target: Vector3, t: f32): Vector3 {
    return new Vector3(
      this.x + (target.x - this.x) * t,
      this.y + (target.y - this.y) * t,
      this.z + (target.z - this.z) * t
    );
  }

  angleTo(v: Vector3): f32 {
    const denom = Mathf.sqrt(this.lengthSquared() * v.lengthSquared());
    if (denom < 0.00001) return 0.0;
    let cosVal = this.dot(v) / denom;
    if (cosVal > f32(1.0)) cosVal = f32(1.0);
    else if (cosVal < f32(-1.0)) cosVal = f32(-1.0);
    return Mathf.acos(cosVal);
  }

  @inline
  reflect(normal: Vector3): Vector3 {
    const factor = 2.0 * this.dot(normal);
    return this.subtract(normal.scale(factor));
  }

  @inline
  equals(v: Vector3, tolerance: f32 = 0.0001): bool {
    return (
      Mathf.abs(this.x - v.x) <= tolerance &&
      Mathf.abs(this.y - v.y) <= tolerance &&
      Mathf.abs(this.z - v.z) <= tolerance
    );
  }

  @inline
  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  @inline static zero(): Vector3 { return new Vector3(0.0, 0.0, 0.0); }
  @inline static one(): Vector3 { return new Vector3(1.0, 1.0, 1.0); }
  @inline static up(): Vector3 { return new Vector3(0.0, 1.0, 0.0); }
  @inline static down(): Vector3 { return new Vector3(0.0, -1.0, 0.0); }
  @inline static forward(): Vector3 { return new Vector3(0.0, 0.0, 1.0); }
  @inline static back(): Vector3 { return new Vector3(0.0, 0.0, -1.0); }
  @inline static left(): Vector3 { return new Vector3(-1.0, 0.0, 0.0); }
  @inline static right(): Vector3 { return new Vector3(1.0, 0.0, 0.0); }
}
