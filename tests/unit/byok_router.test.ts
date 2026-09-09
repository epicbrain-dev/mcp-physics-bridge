import { describe, it, expect, beforeEach } from "vitest";
import { ByokLlmRouter, MATH_API_REFERENCE } from "../../src/mcp/llm/byok_router.js";
import { defaultConfig, BridgeConfig } from "../../src/config.js";
import { GenreTemplate, AnimationLayer, ReflectiveMemoryReport } from "../../src/proto/index.js";

describe("ByokLlmRouter (Bring-Your-Own-Key LLM Routing Subsystem)", () => {
  let router: ByokLlmRouter;
  let testConfig: BridgeConfig;

  beforeEach(() => {
    testConfig = {
      ...defaultConfig,
      byokLlmApiKey: undefined,
      byokLlmEndpoint: undefined,
      byokLlmProvider: "mock",
      byokLlmModel: "test-model",
      byokDefaultTemperature: 0.1,
      byokMaxTokens: 1024,
      byokTimeoutMs: 5000,
    };
    router = new ByokLlmRouter(testConfig);
  });

  describe("Provider and Endpoint Resolution", () => {
    it("defaults to mock provider when no API key is specified and provider is mock", () => {
      expect(router.getEffectiveProvider()).toBe("mock");
    });

    it("resolves to openai provider when api key is provided without explicit provider", () => {
      const cfg: BridgeConfig = { ...testConfig, byokLlmApiKey: "sk-test-123", byokLlmProvider: undefined };
      const r = new ByokLlmRouter(cfg);
      expect(r.getEffectiveProvider()).toBe("openai");
    });

    it("respects per-request provider and model overrides", () => {
      expect(router.getEffectiveProvider({ provider: "anthropic" })).toBe("anthropic");
      expect(router.getEffectiveModel("anthropic", { model: "claude-3-opus" })).toBe("claude-3-opus");
      expect(router.getEffectiveEndpoint("ollama")).toBe("http://localhost:11434/v1");
      expect(router.getEffectiveEndpoint("custom", { endpoint: "http://my-gateway:8080/v1" })).toBe(
        "http://my-gateway:8080/v1"
      );
    });

    it("includes MATH_API_REFERENCE with Vector3 and Quaternion signatures", () => {
      expect(MATH_API_REFERENCE).toContain("class Vector3");
      expect(MATH_API_REFERENCE).toContain("class Quaternion");
      expect(MATH_API_REFERENCE).toContain("slerp");
    });
  });

  describe("Deterministic Mock Provider Operations", () => {
    it("completes prompts using mock provider", async () => {
      const response = await router.complete("Hello physics engine!");
      expect(response).toContain("[mcp-physics-bridge BYOK Mock]");
    });

    it("generates, compiles, and tests an AssemblyScript physics kernel in Wasm sandbox", async () => {
      const result = await router.generatePhysicsKernel("Simulate falling sphere with gravity", {
        moduleId: "gravity_sphere_test",
        entrypointFunction: "stepPhysics",
        testArgs: [0.016],
      });

      expect(result.success).toBe(true);
      expect(result.moduleId).toBe("gravity_sphere_test");
      expect(result.module).toBeDefined();
      expect(result.module?.sourceChecksum).toHaveLength(64); // SHA-256
      expect(result.module?.wasmBytecode.byteLength).toBeGreaterThan(0);
      expect(result.compilation.success).toBe(true);
      expect(result.executionResult?.success).toBe(true);
      // stepPhysics should compute nextPos.y = 10.0 + (-9.81 * 0.016) ≈ 9.843
      expect(result.executionResult?.returnValue).toBeCloseTo(9.843, 2);
    });

    it("repairs failing physics modules using reflective failure reports", async () => {
      const failingSource = `
export function stepPhysics(dt: f32): f32 {
  let x: f32 = 1.0 / 0.0; // NaN / Inf failure
  return x;
}
`;
      const failureReport: ReflectiveMemoryReport = {
        moduleId: "repair_test_module",
        failedFrameId: 42n,
        compressedErrorLogs: "ERROR_NAN_OR_INF: Entity 1 produced Infinity in position Y",
        astDiff: "- let x: f32 = 1.0 / 0.0;\n+ let safeDt = dt > 0.1 ? 0.1 : dt;",
      };

      const repairResult = await router.repairPhysicsFailure(failureReport, failingSource, {
        entrypointFunction: "stepPhysics",
      });

      expect(repairResult.success).toBe(true);
      expect(repairResult.moduleId).toBe("repair_test_module");
      expect(repairResult.module).toBeDefined();
      expect(repairResult.compilation.success).toBe(true);
      expect(repairResult.repairedSource).toContain("stepPhysics");
      expect(repairResult.executionResult?.success).toBe(true);
    });

    it("synthesizes animation intents from natural language action descriptions", async () => {
      const sprintIntent = await router.synthesizeAnimationIntent("Character is sprinting forward", GenreTemplate.GENRE_GENERIC);
      expect(sprintIntent.intentName).toBe("Sprint");
      expect(sprintIntent.desiredVelocity).toBe(8.0);
      expect(sprintIntent.layer).toBe(AnimationLayer.LAYER_FULL_BODY);

      const aimIntent = await router.synthesizeAnimationIntent("Player aims down sights and fires rifle", GenreTemplate.GENRE_FPS);
      expect(aimIntent.intentName).toBe("AimDownSights");
      expect(aimIntent.layer).toBe(AnimationLayer.LAYER_UPPER_BODY);

      const dashIntent = await router.synthesizeAnimationIntent("Player executes a fast dash dodge", GenreTemplate.GENRE_PLATFORMER);
      expect(dashIntent.intentName).toBe("Dash");
      expect(dashIntent.priorityTags).toContain("uninterruptible");
    });
  });

  describe("HTTP-based Providers (OpenAI & Anthropic Formatting with Custom Fetch)", () => {
    it("formats and executes OpenAI-compatible chat requests", async () => {
      let interceptedUrl = "";
      let interceptedBody: any = null;
      let interceptedHeaders: any = null;

      const mockFetch: typeof fetch = async (url, init) => {
        interceptedUrl = url.toString();
        interceptedHeaders = init?.headers;
        interceptedBody = JSON.parse(init?.body as string);

        return new Response(
          JSON.stringify({
            model: "gpt-4o",
            choices: [{ message: { content: "OpenAI mock response" } }],
            usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      router.setFetchHandler(mockFetch);

      const result = await router.chat(
        [{ role: "user", content: "Test prompt" }],
        { provider: "openai", apiKey: "sk-mock-key", model: "gpt-4o" }
      );

      expect(interceptedUrl).toBe("https://api.openai.com/v1/chat/completions");
      expect(interceptedHeaders["Authorization"]).toBe("Bearer sk-mock-key");
      expect(interceptedBody.model).toBe("gpt-4o");
      expect(result.content).toBe("OpenAI mock response");
      expect(result.usage?.totalTokens).toBe(20);
    });

    it("formats and executes Anthropic Claude requests with system message separation", async () => {
      let interceptedUrl = "";
      let interceptedBody: any = null;
      let interceptedHeaders: any = null;

      const mockFetch: typeof fetch = async (url, init) => {
        interceptedUrl = url.toString();
        interceptedHeaders = init?.headers;
        interceptedBody = JSON.parse(init?.body as string);

        return new Response(
          JSON.stringify({
            model: "claude-3-5-sonnet-20241022",
            content: [{ type: "text", text: "Anthropic mock response" }],
            usage: { input_tokens: 25, output_tokens: 10 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      router.setFetchHandler(mockFetch);

      const result = await router.chat(
        [
          { role: "system", content: "System instructions" },
          { role: "user", content: "User question" },
        ],
        { provider: "anthropic", apiKey: "ant-mock-key" }
      );

      expect(interceptedUrl).toBe("https://api.anthropic.com/v1/messages");
      expect(interceptedHeaders["x-api-key"]).toBe("ant-mock-key");
      expect(interceptedHeaders["anthropic-version"]).toBe("2023-06-01");
      expect(interceptedBody.system).toBe("System instructions");
      expect(interceptedBody.messages).toEqual([{ role: "user", content: "User question" }]);
      expect(result.content).toBe("Anthropic mock response");
      expect(result.usage?.totalTokens).toBe(35);
    });

    it("handles HTTP error responses gracefully", async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response("Unauthorized: Invalid API key", { status: 401, statusText: "Unauthorized" });
      };

      router.setFetchHandler(mockFetch);

      await expect(
        router.chat([{ role: "user", content: "Hi" }], { provider: "openai", apiKey: "invalid-key" })
      ).rejects.toThrow("OpenAI API request failed (401 Unauthorized)");
    });
  });
});
