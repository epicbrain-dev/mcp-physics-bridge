import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BridgeConfig } from "../../config.js";
import { InMemoryAssemblyScriptCompiler } from "../../sandbox/compiler.js";
import { WasmContainer } from "../../sandbox/wasm_container.js";
import { DualPayloadVerifier } from "../../sandbox/dual_payload.js";
import { StateAuthorityManager } from "../../validation/authority_manager.js";
import {
  EngineMode,
  PhysicsFrameSoA,
  formatPhysicsErrors,
  PhysicsStatusCode,
} from "../../proto/index.js";

export interface PhysicsToolsDependencies {
  config: BridgeConfig;
  compiler: InMemoryAssemblyScriptCompiler;
  wasmContainer: WasmContainer;
  verifier: DualPayloadVerifier;
  authorityManager: StateAuthorityManager;
}

export const CompilePhysicsSchema = {
  moduleId: z.string().describe("Unique identifier for the physics module"),
  assemblyscriptSource: z.string().describe("AssemblyScript source code to compile"),
  entrypointFunction: z
    .string()
    .optional()
    .default("stepPhysics")
    .describe("Exported function name to test in sandbox"),
  testArgs: z
    .array(z.number())
    .optional()
    .default([0.016])
    .describe("Arguments to pass to the test entrypoint"),
  optimizeLevel: z.number().optional().default(1).describe("AssemblyScript optimization level (0-3)"),
};

const NumericOrString = z.union([z.number(), z.string()]);

export const ValidatePhysicsFrameSchema = {
  frameId: z.string().describe("Physics frame sequence identifier (bigint string)"),
  mode: z.enum(["PLAYTEST", "DEBUG"]).describe("Engine state authority validation mode"),
  entityCount: z.number().describe("Number of active entities in the physics frame"),
  positions: z
    .array(z.object({ x: NumericOrString, y: NumericOrString, z: NumericOrString }))
    .optional()
    .describe("Optional entity positions [x, y, z] (supports numbers or 'NaN'/'Infinity')"),
  velocities: z
    .array(z.object({ x: NumericOrString, y: NumericOrString, z: NumericOrString }))
    .optional()
    .describe("Optional entity linear velocities [vx, vy, vz]"),
  rotations: z
    .array(
      z.object({
        x: NumericOrString,
        y: NumericOrString,
        z: NumericOrString,
        w: NumericOrString,
      })
    )
    .optional()
    .describe("Optional entity orientations [x, y, z, w]"),
  radii: z.array(NumericOrString).optional().describe("Optional collision radii per entity"),
  masses: z.array(NumericOrString).optional().describe("Optional entity masses"),
};

export const DeployDualPayloadSchema = {
  moduleId: z.string().describe("Unique identifier for the logic module"),
  assemblyscriptSource: z.string().describe("Auditable AssemblyScript source code"),
  wasmBytecodeBase64: z
    .string()
    .optional()
    .describe("Optional pre-compiled WebAssembly bytecode (base64 encoded)"),
  sourceChecksum: z.string().optional().describe("Optional SHA-256 source checksum"),
};

/**
 * Registers physics execution and validation tools with the MCP server.
 */
export function registerPhysicsTools(
  server: McpServer,
  deps: PhysicsToolsDependencies
): void {
  // 1. compile_and_test_physics
  server.tool(
    "compile_and_test_physics",
    "Compiles AssemblyScript source in-memory, instantiates in Wasm sandbox, and verifies output stability.",
    CompilePhysicsSchema,
    async ({ moduleId, assemblyscriptSource, entrypointFunction, testArgs, optimizeLevel }) => {
      const entrypoint = entrypointFunction || "stepPhysics";
      const args = testArgs || [0.016];

      // Compile in-memory
      const { module, compilation } = await deps.compiler.compileModule(
        moduleId,
        assemblyscriptSource,
        { optimizeLevel: optimizeLevel ?? 1 }
      );

      if (!compilation.success || !module) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: false,
                  moduleId,
                  error: "Compilation failed",
                  diagnostics: compilation.diagnostics,
                  compilationTimeMs: compilation.compilationTimeMs,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Verify Dual-Payload
      const verification = deps.verifier.verify(module);

      // Load & execute in sandbox container
      const container = deps.wasmContainer;
      const loaded = await container.loadBytecode(module.wasmBytecode);
      const executionResult = loaded
        ? container.execute(entrypoint, ...args)
        : {
            success: false,
            executionTimeMs: 0,
            error: "Failed to instantiate WebAssembly module in sandbox",
            capturedLogs: [],
            memoryBytesUsed: 0,
          };

      const result = {
        success: compilation.success && verification.valid && executionResult.success,
        moduleId,
        sourceChecksum: module.sourceChecksum,
        wasmByteLength: module.wasmBytecode.byteLength,
        compilationTimeMs: compilation.compilationTimeMs,
        verification: {
          valid: verification.valid,
          wasmHeaderValid: verification.wasmHeaderValid,
          errors: verification.errors,
          warnings: verification.warnings,
        },
        execution: {
          success: executionResult.success,
          entrypoint,
          returnValue: executionResult.returnValue,
          executionTimeMs: executionResult.executionTimeMs,
          memoryBytesUsed: executionResult.memoryBytesUsed,
          capturedLogs: executionResult.capturedLogs,
          error: executionResult.error,
        },
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 2. validate_physics_frame
  server.tool(
    "validate_physics_frame",
    "Evaluates an SoA physics frame against Playtest (soft clamp) or Debug (hard reject) rules.",
    ValidatePhysicsFrameSchema,
    async ({
      frameId,
      mode,
      entityCount,
      positions,
      velocities,
      rotations,
      radii,
      masses,
    }) => {
      const count = Math.max(1, entityCount);
      const fId = BigInt(frameId || "1");
      const engineMode = mode === "DEBUG" ? EngineMode.DEBUG : EngineMode.PLAYTEST;

      // Construct SoA buffers
      const entityIds = new Uint32Array(count);
      const posX = new Float32Array(count);
      const posY = new Float32Array(count);
      const posZ = new Float32Array(count);
      const velX = new Float32Array(count);
      const velY = new Float32Array(count);
      const velZ = new Float32Array(count);
      const rotX = new Float32Array(count);
      const rotY = new Float32Array(count);
      const rotZ = new Float32Array(count);
      const rotW = new Float32Array(count);
      const rArr = new Float32Array(count);
      const mArr = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        entityIds[i] = i + 1;
        posX[i] = positions?.[i]?.x !== undefined ? Number(positions[i].x) : 0.0;
        posY[i] = positions?.[i]?.y !== undefined ? Number(positions[i].y) : 0.0;
        posZ[i] = positions?.[i]?.z !== undefined ? Number(positions[i].z) : 0.0;
        velX[i] = velocities?.[i]?.x !== undefined ? Number(velocities[i].x) : 0.0;
        velY[i] = velocities?.[i]?.y !== undefined ? Number(velocities[i].y) : 0.0;
        velZ[i] = velocities?.[i]?.z !== undefined ? Number(velocities[i].z) : 0.0;
        rotX[i] = rotations?.[i]?.x !== undefined ? Number(rotations[i].x) : 0.0;
        rotY[i] = rotations?.[i]?.y !== undefined ? Number(rotations[i].y) : 0.0;
        rotZ[i] = rotations?.[i]?.z !== undefined ? Number(rotations[i].z) : 0.0;
        rotW[i] = rotations?.[i]?.w !== undefined ? Number(rotations[i].w) : 1.0;
        rArr[i] = radii?.[i] !== undefined ? Number(radii[i]) : 0.5;
        mArr[i] = masses?.[i] !== undefined ? Number(masses[i]) : 1.0;
      }

      const frame: PhysicsFrameSoA = {
        frameId: fId,
        timestampNs: BigInt(Date.now()) * 1_000_000n,
        deltaTime: 0.016,
        mode: engineMode,
        entityIds,
        posX,
        posY,
        posZ,
        velX,
        velY,
        velZ,
        rotX,
        rotY,
        rotZ,
        rotW,
        radii: rArr,
        masses: mArr,
      };

      const response = deps.authorityManager.validateFrame(frame);
      const errorList = formatPhysicsErrors(response.frameErrorBitmask ?? 0);

      const result = {
        frameId: response.frameId.toString(),
        mode,
        statusCode: response.statusCode,
        statusName:
          Object.entries(PhysicsStatusCode).find(([_, v]) => v === response.statusCode)?.[0] ?? "UNKNOWN",
        errorMessage: response.errorMessage,
        frameErrorBitmask: response.frameErrorBitmask ?? 0,
        errors: errorList,
        failingEntityIds: response.failingEntityIds ?? [],
        correctedEntities: response.correctedFrame
          ? Array.from(response.correctedFrame.entityIds).map((id, idx) => ({
              id,
              pos: [
                response.correctedFrame!.posX[idx],
                response.correctedFrame!.posY[idx],
                response.correctedFrame!.posZ[idx],
              ],
              vel: [
                response.correctedFrame!.velX[idx],
                response.correctedFrame!.velY[idx],
                response.correctedFrame!.velZ[idx],
              ],
            }))
          : undefined,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 3. deploy_dual_payload_logic
  server.tool(
    "deploy_dual_payload_logic",
    "Verifies and prepares an AssemblyScript + Wasm Dual-Payload module for deployment to the game engine.",
    DeployDualPayloadSchema,
    async ({ moduleId, assemblyscriptSource, wasmBytecodeBase64, sourceChecksum }) => {
      let wasmBytes: Uint8Array;

      if (wasmBytecodeBase64) {
        const buffer = Buffer.from(wasmBytecodeBase64, "base64");
        wasmBytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      } else {
        const compilation = await deps.compiler.compileSource(assemblyscriptSource, {
          optimizeLevel: 1,
        });
        if (!compilation.success || !compilation.wasmBytes) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    moduleId,
                    error: `Bytecode compilation failed: ${compilation.diagnostics.join("; ")}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
        wasmBytes = compilation.wasmBytes;
      }

      const verification = deps.verifier.verify({
        moduleId,
        assemblyscriptSource,
        wasmBytecode: wasmBytes,
        sourceChecksum: sourceChecksum ?? "",
      });

      const result = {
        success: verification.valid,
        moduleId,
        sourceChecksum: verification.computedChecksum,
        matchesProvidedChecksum: verification.matchesProvidedChecksum,
        wasmHeaderValid: verification.wasmHeaderValid,
        wasmByteLength: wasmBytes.byteLength,
        errors: verification.errors,
        warnings: verification.warnings,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

// Backward compatibility export
export const PHYSICS_TOOLS = [
  {
    name: "compile_and_test_physics",
    description:
      "Compiles AssemblyScript source in-memory, executes in Wasm sandbox, and verifies output stability.",
    inputSchema: {
      type: "object",
      properties: {
        moduleId: { type: "string" },
        assemblyscriptSource: { type: "string" },
        entrypointFunction: { type: "string" },
        testArgs: { type: "array", items: { type: "number" } },
      },
      required: ["moduleId", "assemblyscriptSource"],
    },
  },
  {
    name: "validate_physics_frame",
    description:
      "Evaluates an SoA physics frame against Playtest (soft clamp) or Debug (hard reject) rules.",
    inputSchema: {
      type: "object",
      properties: {
        frameId: { type: "string" },
        mode: { type: "string", enum: ["PLAYTEST", "DEBUG"] },
        entityCount: { type: "number" },
      },
      required: ["frameId", "mode", "entityCount"],
    },
  },
  {
    name: "deploy_dual_payload_logic",
    description:
      "Verifies and prepares an AssemblyScript + Wasm Dual-Payload module for deployment to the game engine.",
    inputSchema: {
      type: "object",
      properties: {
        moduleId: { type: "string" },
        assemblyscriptSource: { type: "string" },
      },
      required: ["moduleId", "assemblyscriptSource"],
    },
  },
];
