import { describe, it, expect } from "vitest";
import { DualPayloadVerifier } from "../../src/sandbox/dual_payload.js";
import { InMemoryAssemblyScriptCompiler } from "../../src/sandbox/compiler.js";
import { createHash } from "crypto";

describe("DualPayloadVerifier (Security & Parity Verification)", () => {
  const verifier = new DualPayloadVerifier();
  const compiler = new InMemoryAssemblyScriptCompiler();

  it("verifies a valid dual payload with matching checksum and bytecode", async () => {
    const source = `
      export function clamp(v: f32, minVal: f32, maxVal: f32): f32 {
        if (v < minVal) return minVal;
        if (v > maxVal) return maxVal;
        return v;
      }
    `;

    const { module } = await compiler.compileModule("clamp-mod", source);
    expect(module).toBeDefined();

    const verification = verifier.verify(module!);
    expect(verification.valid).toBe(true);
    expect(verification.matchesProvidedChecksum).toBe(true);
    expect(verification.wasmHeaderValid).toBe(true);
    expect(verification.wasmBytecodeValid).toBe(true);
    expect(verification.errors.length).toBe(0);
  });

  it("rejects payload with mismatched checksum", async () => {
    const source = `export function test(): f32 { return 1.0; }`;
    const { module } = await compiler.compileModule("test-mod", source);
    expect(module).toBeDefined();

    const tamperedModule = {
      ...module!,
      sourceChecksum: "0000000000000000000000000000000000000000000000000000000000000000",
    };

    const verification = verifier.verify(tamperedModule);
    expect(verification.valid).toBe(false);
    expect(verification.matchesProvidedChecksum).toBe(false);
    expect(verification.errors.some((e) => e.includes("Checksum mismatch"))).toBe(true);
  });

  it("rejects empty source code or empty bytecode", () => {
    const emptySourceResult = verifier.verify({
      moduleId: "empty-source",
      assemblyscriptSource: "",
      wasmBytecode: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
      sourceChecksum: "",
    });
    expect(emptySourceResult.valid).toBe(false);
    expect(emptySourceResult.errors).toContain("Source code payload is missing or empty");

    const emptyBytecodeResult = verifier.verify({
      moduleId: "empty-bytes",
      assemblyscriptSource: "export function ok(): void {}",
      wasmBytecode: new Uint8Array(0),
      sourceChecksum: createHash("sha256").update("export function ok(): void {}").digest("hex"),
    });
    expect(emptyBytecodeResult.valid).toBe(false);
    expect(emptyBytecodeResult.errors).toContain("Wasm bytecode payload is missing or empty");
  });

  it("rejects bytecode with corrupted magic header", () => {
    const corruptedHeader = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
    const source = "export function noop(): void {}";

    const result = verifier.verify({
      moduleId: "corrupted-mod",
      assemblyscriptSource: source,
      wasmBytecode: corruptedHeader,
      sourceChecksum: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.valid).toBe(false);
    expect(result.wasmHeaderValid).toBe(false);
    expect(result.errors.some((e) => e.includes("header magic or version mismatch"))).toBe(true);
  });

  it("rejects bytecode that fails WebAssembly structure validation", () => {
    // Valid 8-byte header followed by corrupted section bytes
    const malformedWasm = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0xff, 0xff, 0xff, 0xff,
    ]);
    const source = "export function noop(): void {}";

    const result = verifier.verify({
      moduleId: "malformed-mod",
      assemblyscriptSource: source,
      wasmBytecode: malformedWasm,
      sourceChecksum: createHash("sha256").update(source).digest("hex"),
    });

    expect(result.valid).toBe(false);
    expect(result.wasmHeaderValid).toBe(true);
    expect(result.wasmBytecodeValid).toBe(false);
    expect(result.errors.some((e) => e.includes("WebAssembly bytecode validation failed"))).toBe(true);
  });

  it("detects unauthorized external sandbox escapes in source code", () => {
    const maliciousSource = `
      @external("host_filesystem", "readFile")
      declare function readHostFile(path: string): string;

      export function exploit(): void {
        readHostFile("/etc/passwd");
      }
    `;

    const result = verifier.verify({
      moduleId: "malicious-mod",
      assemblyscriptSource: maliciousSource,
      wasmBytecode: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
      sourceChecksum: createHash("sha256").update(maliciousSource).digest("hex"),
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Disallowed external module import"))).toBe(true);
  });

  it("performs full parity verification by recompiling source in-memory", async () => {
    const validSource = `export function calc(x: f32): f32 { return x * 3.0; }`;
    const { module } = await compiler.compileModule("parity-mod", validSource);

    const parityResult = await verifier.verifyParity(module!, compiler);
    expect(parityResult.valid).toBe(true);
  });
});
