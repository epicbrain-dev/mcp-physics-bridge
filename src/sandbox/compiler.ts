import * as asc from "assemblyscript/asc";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { DualPayloadModule } from "../proto/index.js";

export interface CompilerOptions {
  optimizeLevel?: number;
  shrinkLevel?: number;
  runtime?: "stub" | "incremental" | "minimal";
  importMemory?: boolean;
  noAssert?: boolean;
  extraFiles?: Record<string, string>;
}

export interface CompilationResult {
  success: boolean;
  wasmBytes?: Uint8Array;
  compilationTimeMs: number;
  diagnostics: string[];
  textWat?: string;
}

// Fallback embedded sources for standalone/dist execution where source .ts files may not be on disk
const EMBEDDED_VECTOR3_SOURCE = `
export class Vector3 {
  public x: f32;
  public y: f32;
  public z: f32;

  constructor(x: f32 = 0.0, y: f32 = 0.0, z: f32 = 0.0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  @inline set(x: f32, y: f32, z: f32): Vector3 {
    this.x = x; this.y = y; this.z = z; return this;
  }
  @inline add(v: Vector3): Vector3 {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  @inline subtract(v: Vector3): Vector3 {
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  @inline scale(scalar: f32): Vector3 {
    return new Vector3(this.x * scalar, this.y * scalar, this.z * scalar);
  }
  @inline multiply(v: Vector3): Vector3 {
    return new Vector3(this.x * v.x, this.y * v.y, this.z * v.z);
  }
  @inline divide(scalar: f32): Vector3 {
    const inv: f32 = f32(1.0) / scalar;
    return new Vector3(this.x * inv, this.y * inv, this.z * inv);
  }
  @inline negate(): Vector3 {
    return new Vector3(-this.x, -this.y, -this.z);
  }
  @inline dot(v: Vector3): f32 {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  @inline cross(v: Vector3): Vector3 {
    return new Vector3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }
  @inline lengthSquared(): f32 {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  @inline length(): f32 {
    return Mathf.sqrt(this.lengthSquared());
  }
  @inline distanceSquared(v: Vector3): f32 {
    const dx = this.x - v.x; const dy = this.y - v.y; const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
  @inline distance(v: Vector3): f32 {
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
  @inline lerp(target: Vector3, t: f32): Vector3 {
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
  @inline reflect(normal: Vector3): Vector3 {
    const factor = 2.0 * this.dot(normal);
    return this.subtract(normal.scale(factor));
  }
  @inline equals(v: Vector3, tolerance: f32 = 0.0001): bool {
    return (
      Mathf.abs(this.x - v.x) <= tolerance &&
      Mathf.abs(this.y - v.y) <= tolerance &&
      Mathf.abs(this.z - v.z) <= tolerance
    );
  }
  @inline clone(): Vector3 { return new Vector3(this.x, this.y, this.z); }
  @inline static zero(): Vector3 { return new Vector3(0.0, 0.0, 0.0); }
  @inline static one(): Vector3 { return new Vector3(1.0, 1.0, 1.0); }
  @inline static up(): Vector3 { return new Vector3(0.0, 1.0, 0.0); }
  @inline static down(): Vector3 { return new Vector3(0.0, -1.0, 0.0); }
  @inline static forward(): Vector3 { return new Vector3(0.0, 0.0, 1.0); }
  @inline static back(): Vector3 { return new Vector3(0.0, 0.0, -1.0); }
  @inline static left(): Vector3 { return new Vector3(-1.0, 0.0, 0.0); }
  @inline static right(): Vector3 { return new Vector3(1.0, 0.0, 0.0); }
}
`;

const EMBEDDED_QUATERNION_SOURCE = `
import { Vector3 } from "./vector3";

export class Quaternion {
  public x: f32;
  public y: f32;
  public z: f32;
  public w: f32;

  constructor(x: f32 = 0.0, y: f32 = 0.0, z: f32 = 0.0, w: f32 = 1.0) {
    this.x = x; this.y = y; this.z = z; this.w = w;
  }
  @inline static identity(): Quaternion { return new Quaternion(0.0, 0.0, 0.0, 1.0); }
  @inline multiply(q: Quaternion): Quaternion {
    return new Quaternion(
      this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
      this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
      this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w,
      this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z
    );
  }
  @inline conjugate(): Quaternion { return new Quaternion(-this.x, -this.y, -this.z, this.w); }
  @inline lengthSquared(): f32 {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }
  @inline length(): f32 { return Mathf.sqrt(this.lengthSquared()); }
  normalize(): Quaternion {
    const len = this.length();
    if (len > 0.00001) {
      const inv: f32 = f32(1.0) / len;
      return new Quaternion(this.x * inv, this.y * inv, this.z * inv, this.w * inv);
    }
    return Quaternion.identity();
  }
  @inline dot(q: Quaternion): f32 {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
  }
  @inline inverse(): Quaternion {
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
      targetX = -targetX; targetY = -targetY; targetZ = -targetZ; targetW = -targetW;
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
  @inline clone(): Quaternion { return new Quaternion(this.x, this.y, this.z, this.w); }
  @inline equals(q: Quaternion, tolerance: f32 = 0.0001): bool {
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
    return new Quaternion(normAxis.x * s, normAxis.y * s, normAxis.z * s, Mathf.cos(halfAngle));
  }
  static fromEuler(pitch: f32, yaw: f32, roll: f32): Quaternion {
    const c1 = Mathf.cos(pitch * 0.5); const s1 = Mathf.sin(pitch * 0.5);
    const c2 = Mathf.cos(yaw * 0.5); const s2 = Mathf.sin(yaw * 0.5);
    const c3 = Mathf.cos(roll * 0.5); const s3 = Mathf.sin(roll * 0.5);
    return new Quaternion(
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 + s1 * s2 * c3,
      c1 * c2 * c3 - s1 * s2 * s3
    );
  }
}
`;

/**
 * InMemoryAssemblyScriptCompiler compiles AI-generated AssemblyScript source code
 * directly to Wasm bytecode in-memory without disk I/O bottlenecks.
 * Bundles the sandbox math library (Vector3 and Quaternion) automatically into the virtual filesystem.
 */
export class InMemoryAssemblyScriptCompiler {
  private static cachedVector3Source: string | null = null;
  private static cachedQuaternionSource: string | null = null;

  constructor() {
    InMemoryAssemblyScriptCompiler.ensureMathSourcesLoaded();
  }

  private static ensureMathSourcesLoaded(): void {
    if (this.cachedVector3Source && this.cachedQuaternionSource) {
      return;
    }

    try {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const candidates = [
        path.resolve(currentDir, "assemblyscript/math"),
        path.resolve(currentDir, "../sandbox/assemblyscript/math"),
        path.resolve(process.cwd(), "src/sandbox/assemblyscript/math"),
      ];

      for (const candidate of candidates) {
        const v3File = path.join(candidate, "vector3.ts");
        const quatFile = path.join(candidate, "quaternion.ts");
        if (fs.existsSync(v3File) && fs.existsSync(quatFile)) {
          this.cachedVector3Source = fs.readFileSync(v3File, "utf-8");
          this.cachedQuaternionSource = fs.readFileSync(quatFile, "utf-8");
          return;
        }
      }
    } catch {
      // Ignore filesystem errors and use embedded fallback
    }

    this.cachedVector3Source = EMBEDDED_VECTOR3_SOURCE;
    this.cachedQuaternionSource = EMBEDDED_QUATERNION_SOURCE;
  }

  /**
   * Returns the bundled Vector3 AssemblyScript source code.
   */
  public getVector3Source(): string {
    InMemoryAssemblyScriptCompiler.ensureMathSourcesLoaded();
    return InMemoryAssemblyScriptCompiler.cachedVector3Source!;
  }

  /**
   * Returns the bundled Quaternion AssemblyScript source code.
   */
  public getQuaternionSource(): string {
    InMemoryAssemblyScriptCompiler.ensureMathSourcesLoaded();
    return InMemoryAssemblyScriptCompiler.cachedQuaternionSource!;
  }

  /**
   * Compiles source code string to WebAssembly binary in-memory.
   */
  public async compileSource(
    sourceCode: string,
    options: CompilerOptions = {}
  ): Promise<CompilationResult> {
    const startTime = performance.now();
    const diagnostics: string[] = [];

    if (!sourceCode || !sourceCode.trim()) {
      diagnostics.push("Empty source code provided");
      return {
        success: false,
        compilationTimeMs: performance.now() - startTime,
        diagnostics,
      };
    }

    InMemoryAssemblyScriptCompiler.ensureMathSourcesLoaded();
    const v3Source = InMemoryAssemblyScriptCompiler.cachedVector3Source!;
    const quatSource = InMemoryAssemblyScriptCompiler.cachedQuaternionSource!;

    const virtualFiles: Record<string, string> = {
      "input.ts": sourceCode,
      "math/vector3.ts": v3Source,
      "math/quaternion.ts": quatSource,
      "vector3.ts": v3Source,
      "quaternion.ts": quatSource,
      ...options.extraFiles,
    };

    const ascArgs: Record<string, unknown> = {
      optimizeLevel: options.optimizeLevel ?? 1,
      shrinkLevel: options.shrinkLevel ?? 0,
      runtime: options.runtime ?? "stub",
      exportRuntime: true,
      importMemory: options.importMemory ?? false,
      noAssert: options.noAssert ?? false,
    };

    try {
      const compileOutput = await asc.compileString(virtualFiles, ascArgs);
      const compilationTimeMs = performance.now() - startTime;

      if (compileOutput.stderr) {
        const stderrStr = compileOutput.stderr.toString();
        if (stderrStr.trim().length > 0) {
          const lines = stderrStr.split("\n").filter((l) => l.trim().length > 0);
          diagnostics.push(...lines);
        }
      }

      if (compileOutput.error || !compileOutput.binary) {
        if (compileOutput.error && !diagnostics.includes(compileOutput.error.message)) {
          diagnostics.push(compileOutput.error.message);
        }
        return {
          success: false,
          compilationTimeMs,
          diagnostics,
        };
      }

      return {
        success: true,
        wasmBytes: compileOutput.binary,
        compilationTimeMs,
        diagnostics,
        textWat: compileOutput.text ?? undefined,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.push(message);
      return {
        success: false,
        compilationTimeMs: performance.now() - startTime,
        diagnostics,
      };
    }
  }

  /**
   * Compiles source code and generates a complete DualPayloadModule ready for deployment.
   */
  public async compileModule(
    moduleId: string,
    sourceCode: string,
    options: CompilerOptions = {}
  ): Promise<{ module?: DualPayloadModule; compilation: CompilationResult }> {
    const compilation = await this.compileSource(sourceCode, options);
    if (!compilation.success || !compilation.wasmBytes) {
      return { compilation };
    }

    const hash = createHash("sha256");
    hash.update(sourceCode);
    const sourceChecksum = hash.digest("hex");

    const module: DualPayloadModule = {
      moduleId,
      assemblyscriptSource: sourceCode,
      wasmBytecode: compilation.wasmBytes,
      sourceChecksum,
      compilerVersion: asc.version,
      optimizationTarget: `O${options.optimizeLevel ?? 1}`,
    };

    return { module, compilation };
  }
}
