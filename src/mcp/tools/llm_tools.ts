import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ByokLlmRouter } from "../llm/byok_router.js";
import { ReflectiveMemoryReport } from "../../proto/index.js";

export interface LlmToolsDependencies {
  byokRouter: ByokLlmRouter;
}

export const GeneratePhysicsKernelSchema = {
  description: z.string().describe("Natural language description of physics kernel to generate"),
  moduleId: z.string().optional().describe("Module identifier"),
  entrypointFunction: z
    .string()
    .optional()
    .default("stepPhysics")
    .describe("Exported function name (e.g. stepPhysics)"),
  testArgs: z
    .array(z.number())
    .optional()
    .default([0.016])
    .describe("Test arguments to pass to the sandbox"),
  provider: z
    .enum(["openai", "anthropic", "gemini", "ollama", "custom", "mock"])
    .optional()
    .describe("Optional BYOK LLM provider override"),
};

export const RepairPhysicsKernelSchema = {
  moduleId: z.string().describe("Unique identifier for the failing module"),
  originalSource: z.string().describe("Original failing AssemblyScript source code"),
  errorLog: z.string().describe("Runtime error log or bitmask failure description"),
  astDiff: z.string().optional().default("").describe("Optional AST diff showing previous iterations"),
  failedFrameId: z.string().optional().default("0").describe("Frame ID where failure occurred"),
  entrypointFunction: z
    .string()
    .optional()
    .default("stepPhysics")
    .describe("Exported function name to test in sandbox"),
};

/**
 * Registers BYOK LLM code generation and self-repair tools with the MCP server.
 */
export function registerLlmTools(server: McpServer, deps: LlmToolsDependencies): void {
  // 1. generate_physics_kernel
  server.tool(
    "generate_physics_kernel",
    "Uses BYOK LLM routing to generate, compile, and sandbox-test a deterministic AssemblyScript physics kernel.",
    GeneratePhysicsKernelSchema,
    async ({ description, moduleId, entrypointFunction, testArgs, provider }) => {
      const result = await deps.byokRouter.generatePhysicsKernel(description, {
        moduleId,
        entrypointFunction,
        testArgs,
        provider,
      });

      const response = {
        success: result.success,
        moduleId: result.moduleId,
        sourceChecksum: result.module?.sourceChecksum,
        wasmByteLength: result.module?.wasmBytecode.byteLength,
        compilation: {
          success: result.compilation.success,
          compilationTimeMs: result.compilation.compilationTimeMs,
          diagnostics: result.compilation.diagnostics,
        },
        executionResult: result.executionResult
          ? {
              success: result.executionResult.success,
              returnValue: result.executionResult.returnValue,
              executionTimeMs: result.executionResult.executionTimeMs,
              memoryBytesUsed: result.executionResult.memoryBytesUsed,
              capturedLogs: result.executionResult.capturedLogs,
              error: result.executionResult.error,
            }
          : undefined,
        assemblyscriptSource: result.assemblyscriptSource,
        error: result.error,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  // 2. repair_physics_kernel
  server.tool(
    "repair_physics_kernel",
    "Uses BYOK LLM routing and reflective memory (AST diff + error logs) to automatically fix a failing physics module.",
    RepairPhysicsKernelSchema,
    async ({ moduleId, originalSource, errorLog, astDiff, failedFrameId, entrypointFunction }) => {
      const report: ReflectiveMemoryReport = {
        moduleId,
        astDiff: astDiff || "",
        compressedErrorLogs: errorLog,
        failedFrameId: BigInt(failedFrameId || "0"),
      };

      const result = await deps.byokRouter.repairPhysicsFailure(report, originalSource, {
        entrypointFunction,
      });

      const response = {
        success: result.success,
        moduleId: result.moduleId,
        sourceChecksum: result.module?.sourceChecksum,
        wasmByteLength: result.module?.wasmBytecode.byteLength,
        compilation: {
          success: result.compilation.success,
          compilationTimeMs: result.compilation.compilationTimeMs,
          diagnostics: result.compilation.diagnostics,
        },
        executionResult: result.executionResult
          ? {
              success: result.executionResult.success,
              returnValue: result.executionResult.returnValue,
              executionTimeMs: result.executionResult.executionTimeMs,
              memoryBytesUsed: result.executionResult.memoryBytesUsed,
              capturedLogs: result.executionResult.capturedLogs,
              error: result.executionResult.error,
            }
          : undefined,
        repairedSource: result.repairedSource,
        error: result.error,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}
