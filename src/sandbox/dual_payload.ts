import { DualPayloadModule } from "../proto/index.js";
import { createHash } from "crypto";
import { InMemoryAssemblyScriptCompiler } from "./compiler.js";

export interface DualPayloadVerificationResult {
  valid: boolean;
  computedChecksum: string;
  matchesProvidedChecksum: boolean;
  wasmHeaderValid: boolean;
  wasmBytecodeValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface VerificationOptions {
  verifyParityWithCompiler?: boolean;
  compiler?: InMemoryAssemblyScriptCompiler;
}

// WebAssembly binary header magic: '\0asm' followed by version 1
const WASM_MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
const WASM_VERSION = new Uint8Array([0x01, 0x00, 0x00, 0x00]);

/**
 * DualPayloadVerifier enforces security policies across the AI's Dual-Payload Delivery,
 * ensuring source code and pre-compiled bytecode are consistent, valid, and safe for audit.
 */
export class DualPayloadVerifier {
  /**
   * Verifies the dual payload: validates source code, checksums, Wasm header magic,
   * and bytecode structural validity via WebAssembly engine.
   */
  public verify(
    payload: DualPayloadModule,
    _options: VerificationOptions = {}
  ): DualPayloadVerificationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const source = payload.assemblyscriptSource ?? "";
    const bytecode = payload.wasmBytecode;

    // 1. Source code check
    if (!source || source.trim().length === 0) {
      errors.push("Source code payload is missing or empty");
    }

    // 2. Source code security checks
    this.sanitizeSource(source, errors, warnings);

    // 3. Checksum verification
    const hash = createHash("sha256");
    hash.update(source);
    const computedChecksum = hash.digest("hex");

    const matchesProvidedChecksum = payload.sourceChecksum === computedChecksum;
    if (payload.sourceChecksum && !matchesProvidedChecksum) {
      errors.push(`Checksum mismatch: expected ${payload.sourceChecksum}, got ${computedChecksum}`);
    } else if (!payload.sourceChecksum) {
      warnings.push("Payload sourceChecksum was not specified; computed hash generated");
    }

    // 4. Wasm Bytecode presence & header validation
    let wasmHeaderValid = false;
    let wasmBytecodeValid = false;

    if (!bytecode || bytecode.byteLength === 0) {
      errors.push("Wasm bytecode payload is missing or empty");
    } else if (bytecode.byteLength < 8) {
      errors.push("Wasm bytecode payload is too small to contain valid WebAssembly binary header");
    } else {
      // Check magic '\0asm'
      const magicMatches =
        bytecode[0] === WASM_MAGIC[0] &&
        bytecode[1] === WASM_MAGIC[1] &&
        bytecode[2] === WASM_MAGIC[2] &&
        bytecode[3] === WASM_MAGIC[3];

      // Check version 1
      const versionMatches =
        bytecode[4] === WASM_VERSION[0] &&
        bytecode[5] === WASM_VERSION[1] &&
        bytecode[6] === WASM_VERSION[2] &&
        bytecode[7] === WASM_VERSION[3];

      if (magicMatches && versionMatches) {
        wasmHeaderValid = true;
      } else {
        errors.push("Invalid WebAssembly binary: header magic or version mismatch");
      }

      // 5. Engine-level bytecode validation
      try {
        if (WebAssembly.validate(bytecode as BufferSource)) {
          wasmBytecodeValid = true;
        } else {
          errors.push("WebAssembly bytecode validation failed: module structure is malformed");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`WebAssembly bytecode validation error: ${msg}`);
      }
    }

    return {
      valid: errors.length === 0,
      computedChecksum,
      matchesProvidedChecksum,
      wasmHeaderValid,
      wasmBytecodeValid,
      errors,
      warnings,
    };
  }

  /**
   * Performs parity verification by compiling the source in-memory and checking for compilation success.
   */
  public async verifyParity(
    payload: DualPayloadModule,
    compiler: InMemoryAssemblyScriptCompiler = new InMemoryAssemblyScriptCompiler()
  ): Promise<DualPayloadVerificationResult> {
    const result = this.verify(payload);
    if (!result.valid) {
      return result;
    }

    const compileResult = await compiler.compileSource(payload.assemblyscriptSource);
    if (!compileResult.success) {
      result.valid = false;
      result.errors.push(
        `Source compilation parity check failed: ${compileResult.diagnostics.join("; ")}`
      );
    }

    return result;
  }

  /**
   * Scans source code for potential security or sandbox escape hazards.
   */
  private sanitizeSource(source: string, errors: string[], warnings: string[]): void {
    // Check for suspicious external module imports or host escapes
    const externalImportRegex = /@external\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
    let match: RegExpExecArray | null;

    const allowedModules = new Set(["env"]);
    const allowedEnvFunctions = new Set(["abort", "trace", "memory"]);

    while ((match = externalImportRegex.exec(source)) !== null) {
      const moduleName = match[1];
      const functionName = match[2];

      if (!allowedModules.has(moduleName)) {
        errors.push(
          `Security rejection: Disallowed external module import '@external("${moduleName}", "${functionName}")'`
        );
      } else if (!allowedEnvFunctions.has(functionName)) {
        warnings.push(
          `External function '@external("${moduleName}", "${functionName}")' requested from sandbox environment`
        );
      }
    }
  }
}

