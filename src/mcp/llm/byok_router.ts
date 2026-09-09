import { BridgeConfig, ByokLlmProvider } from "../../config.js";
import {
  DualPayloadModule,
  ReflectiveMemoryReport,
  AnimationIntent,
  GenreTemplate,
  AnimationLayer,
} from "../../proto/index.js";
import {
  InMemoryAssemblyScriptCompiler,
  CompilationResult,
} from "../../sandbox/compiler.js";
import { WasmContainer, SandboxExecutionResult } from "../../sandbox/wasm_container.js";
import { DualPayloadVerifier } from "../../sandbox/dual_payload.js";
import { GAME_PHYSICS_SYSTEM_PROMPT } from "../prompts/game_heuristics.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  provider?: ByokLlmProvider;
  apiKey?: string;
  endpoint?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  provider: ByokLlmProvider;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  rawResponse?: unknown;
}

export interface GenerateKernelOptions extends ChatCompletionOptions {
  moduleId?: string;
  entrypointFunction?: string;
  testArgs?: number[];
  contextJson?: string;
}

export interface GenerateKernelResult {
  success: boolean;
  moduleId: string;
  assemblyscriptSource: string;
  module?: DualPayloadModule;
  compilation: CompilationResult;
  executionResult?: SandboxExecutionResult;
  error?: string;
  rawResponse?: string;
}

export interface RepairKernelOptions extends ChatCompletionOptions {
  entrypointFunction?: string;
  testArgs?: number[];
}

export interface RepairKernelResult {
  success: boolean;
  moduleId: string;
  repairedSource: string;
  module?: DualPayloadModule;
  compilation: CompilationResult;
  executionResult?: SandboxExecutionResult;
  error?: string;
  rawResponse?: string;
}

export interface SynthesizeIntentOptions extends ChatCompletionOptions {
  currentVelocity?: number;
  onGround?: boolean;
}

/**
 * AssemblyScript Math Library API reference provided to LLMs
 */
export const MATH_API_REFERENCE = `
BUNDLED ASSEMBLYSCRIPT MATH LIBRARY (Import path: "./math/vector3" and "./math/quaternion"):
- class Vector3(x: f32 = 0.0, y: f32 = 0.0, z: f32 = 0.0)
  Methods:
  - set(x: f32, y: f32, z: f32): Vector3
  - add(v: Vector3): Vector3
  - subtract(v: Vector3): Vector3
  - scale(scalar: f32): Vector3
  - multiply(v: Vector3): Vector3
  - divide(scalar: f32): Vector3
  - negate(): Vector3
  - dot(v: Vector3): f32
  - cross(v: Vector3): Vector3
  - length(): f32
  - lengthSquared(): f32
  - normalize(): Vector3
  - distanceTo(v: Vector3): f32
  - lerp(target: Vector3, t: f32): Vector3

- class Quaternion(x: f32 = 0.0, y: f32 = 0.0, z: f32 = 0.0, w: f32 = 1.0)
  Methods:
  - set(x: f32, y: f32, z: f32, w: f32): Quaternion
  - identity(): Quaternion
  - multiply(q: Quaternion): Quaternion
  - rotateVector(v: Vector3): Vector3
  - length(): f32
  - normalize(): Quaternion
  - conjugate(): Quaternion
  - inverse(): Quaternion
  - slerp(target: Quaternion, t: f32): Quaternion
  - static fromEuler(pitch: f32, yaw: f32, roll: f32): Quaternion
  - static fromAxisAngle(axis: Vector3, angleRad: f32): Quaternion
`.trim();

/**
 * ByokLlmRouter routes LLM generation and reasoning requests according to the
 * Bring-Your-Own-Key (BYOK) architecture. Supports OpenAI-compatible endpoints,
 * Anthropic, Gemini, Ollama, custom providers, and deterministic offline mock mode.
 */
export class ByokLlmRouter {
  private readonly config: BridgeConfig;
  private readonly compiler: InMemoryAssemblyScriptCompiler;
  private readonly wasmContainer: WasmContainer;
  private readonly verifier: DualPayloadVerifier;
  private customFetch?: typeof fetch;

  constructor(
    config: BridgeConfig,
    options?: {
      fetchFn?: typeof fetch;
      compiler?: InMemoryAssemblyScriptCompiler;
      wasmContainer?: WasmContainer;
    }
  ) {
    this.config = config;
    this.customFetch = options?.fetchFn;
    this.compiler = options?.compiler ?? new InMemoryAssemblyScriptCompiler();
    this.wasmContainer = options?.wasmContainer ?? new WasmContainer(config);
    this.verifier = new DualPayloadVerifier();
  }

  public setFetchHandler(fetchFn: typeof fetch): void {
    this.customFetch = fetchFn;
  }

  public getEffectiveProvider(options?: ChatCompletionOptions): ByokLlmProvider {
    return (
      options?.provider ||
      this.config.byokLlmProvider ||
      (this.config.byokLlmApiKey ? "openai" : "mock")
    );
  }

  public getEffectiveApiKey(options?: ChatCompletionOptions): string | undefined {
    return options?.apiKey || this.config.byokLlmApiKey;
  }

  public getEffectiveEndpoint(
    provider: ByokLlmProvider,
    options?: ChatCompletionOptions
  ): string {
    if (options?.endpoint) return options.endpoint;
    if (this.config.byokLlmEndpoint) return this.config.byokLlmEndpoint;

    switch (provider) {
      case "openai":
        return "https://api.openai.com/v1";
      case "anthropic":
        return "https://api.anthropic.com/v1";
      case "gemini":
        return "https://generativelanguage.googleapis.com/v1beta/openai";
      case "ollama":
        return "http://localhost:11434/v1";
      default:
        return "http://localhost:8000/v1";
    }
  }

  public getEffectiveModel(provider: ByokLlmProvider, options?: ChatCompletionOptions): string {
    if (options?.model) return options.model;
    if (this.config.byokLlmModel) return this.config.byokLlmModel;

    switch (provider) {
      case "openai":
        return "gpt-4o";
      case "anthropic":
        return "claude-3-5-sonnet-20241022";
      case "gemini":
        return "gemini-1.5-pro";
      case "ollama":
        return "llama3";
      default:
        return "default-model";
    }
  }

  /**
   * Dispatches a chat completion request to the configured or requested provider.
   */
  public async chat(
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const provider = this.getEffectiveProvider(options);

    if (provider === "mock") {
      return this.handleMockChat(messages, options);
    }

    if (provider === "anthropic") {
      return this.handleAnthropicChat(messages, options);
    }

    // Default to OpenAI-compatible endpoint (works for OpenAI, Gemini OpenAI proxy, Ollama, custom)
    return this.handleOpenAIChat(messages, options, provider);
  }

  /**
   * Convenience single prompt completion.
   */
  public async complete(prompt: string, options?: ChatCompletionOptions): Promise<string> {
    const messages: ChatMessage[] = [
      { role: "system", content: GAME_PHYSICS_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];
    const result = await this.chat(messages, options);
    return result.content;
  }

  /**
   * Prompts the LLM to generate an AssemblyScript physics kernel, compiles it
   * in-memory into WebAssembly, executes it in the Wasm container, and returns
   * a verified Dual-Payload module.
   */
  public async generatePhysicsKernel(
    description: string,
    options?: GenerateKernelOptions
  ): Promise<GenerateKernelResult> {
    const moduleId = options?.moduleId ?? `physics_kernel_${Date.now()}`;
    const entrypoint = options?.entrypointFunction ?? "stepPhysics";
    const testArgs = options?.testArgs ?? [0.016]; // ~60 FPS dt

    const promptMessages: ChatMessage[] = [
      {
        role: "system",
        content: `${GAME_PHYSICS_SYSTEM_PROMPT}\n\n${MATH_API_REFERENCE}`,
      },
      {
        role: "user",
        content: `Generate a deterministic AssemblyScript physics module meeting these specifications:
Task: ${description}
Module ID: ${moduleId}
Required entrypoint: export function ${entrypoint}(dt: f32): f32
${options?.contextJson ? `Scene / ECS Context:\n${options.contextJson}` : ""}

Constraints:
1. Return clean AssemblyScript code wrapped in \`\`\`typescript ... \`\`\` code fence.
2. Use Vector3 and Quaternion from "./math/vector3" and "./math/quaternion".
3. Avoid memory leaks, AoS allocations, NaNs, or Infinities.
4. Ensure deterministic calculations.`,
      },
    ];

    try {
      const chatResponse = await this.chat(promptMessages, options);
      const sourceCode = this.extractCodeBlock(chatResponse.content);

      if (!sourceCode) {
        return {
          success: false,
          moduleId,
          assemblyscriptSource: "",
          compilation: {
            success: false,
            compilationTimeMs: 0,
            diagnostics: ["No AssemblyScript code block detected in LLM response"],
          },
          error: "Failed to extract AssemblyScript code from LLM response",
          rawResponse: chatResponse.content,
        };
      }

      // Compile in-memory
      const { module, compilation } = await this.compiler.compileModule(moduleId, sourceCode, {
        optimizeLevel: 1,
      });

      if (!compilation.success || !module) {
        return {
          success: false,
          moduleId,
          assemblyscriptSource: sourceCode,
          compilation,
          error: `Compilation failed: ${compilation.diagnostics.join("; ")}`,
          rawResponse: chatResponse.content,
        };
      }

      // Verify Dual-Payload structure
      const verification = this.verifier.verify(module);
      if (!verification.valid) {
        return {
          success: false,
          moduleId,
          assemblyscriptSource: sourceCode,
          module,
          compilation,
          error: `Dual-Payload verification failed: ${verification.errors.join("; ")}`,
          rawResponse: chatResponse.content,
        };
      }

      // Test execution in Wasm container
      const loaded = await this.wasmContainer.loadBytecode(module.wasmBytecode);
      let executionResult: SandboxExecutionResult | undefined;

      if (loaded) {
        executionResult = this.wasmContainer.execute(entrypoint, ...testArgs);
      }

      return {
        success: true,
        moduleId,
        assemblyscriptSource: sourceCode,
        module,
        compilation,
        executionResult,
        rawResponse: chatResponse.content,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        moduleId,
        assemblyscriptSource: "",
        compilation: {
          success: false,
          compilationTimeMs: 0,
          diagnostics: [message],
        },
        error: message,
      };
    }
  }

  /**
   * Prompts the LLM to analyze a reflective memory failure report (with AST diff and error logs)
   * and repair the failing AssemblyScript module.
   */
  public async repairPhysicsFailure(
    report: ReflectiveMemoryReport,
    originalSource: string,
    options?: RepairKernelOptions
  ): Promise<RepairKernelResult> {
    const moduleId = report.moduleId;
    const entrypoint = options?.entrypointFunction ?? "stepPhysics";
    const testArgs = options?.testArgs ?? [0.016];

    const promptMessages: ChatMessage[] = [
      {
        role: "system",
        content: `${GAME_PHYSICS_SYSTEM_PROMPT}\n\n${MATH_API_REFERENCE}`,
      },
      {
        role: "user",
        content: `Fix the following failing AssemblyScript physics module based on its reflective failure report:
Module ID: ${moduleId}
Failed Frame ID: ${report.failedFrameId.toString()}

--- ORIGINAL SOURCE CODE ---
${originalSource}

--- REFLECTIVE ERROR LOGS ---
${report.compressedErrorLogs}

--- ABSTRACT SYNTAX TREE (AST) DIFF ---
${report.astDiff}

${report.diagnosticTrace?.consoleLogs ? `Trace Logs:\n${report.diagnosticTrace.consoleLogs.join("\n")}` : ""}

Constraints:
1. Fix the error (e.g. guard against division by zero, NaN, unbounded velocity, unnormalized quaternions).
2. Return the COMPLETE fixed AssemblyScript code wrapped in \`\`\`typescript ... \`\`\` code block.
3. Keep the exported entrypoint \`export function ${entrypoint}(dt: f32): f32\`.`,
      },
    ];

    try {
      const chatResponse = await this.chat(promptMessages, options);
      const repairedSource = this.extractCodeBlock(chatResponse.content);

      if (!repairedSource) {
        return {
          success: false,
          moduleId,
          repairedSource: "",
          compilation: {
            success: false,
            compilationTimeMs: 0,
            diagnostics: ["No repaired AssemblyScript code found in response"],
          },
          error: "Failed to extract repaired code from LLM response",
          rawResponse: chatResponse.content,
        };
      }

      // Re-compile
      const { module, compilation } = await this.compiler.compileModule(moduleId, repairedSource, {
        optimizeLevel: 1,
      });

      if (!compilation.success || !module) {
        return {
          success: false,
          moduleId,
          repairedSource,
          compilation,
          error: `Repaired module compilation failed: ${compilation.diagnostics.join("; ")}`,
          rawResponse: chatResponse.content,
        };
      }

      // Load & execute in sandbox
      const loaded = await this.wasmContainer.loadBytecode(module.wasmBytecode);
      let executionResult: SandboxExecutionResult | undefined;

      if (loaded) {
        executionResult = this.wasmContainer.execute(entrypoint, ...testArgs);
      }

      return {
        success: true,
        moduleId,
        repairedSource,
        module,
        compilation,
        executionResult,
        rawResponse: chatResponse.content,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        moduleId,
        repairedSource: "",
        compilation: {
          success: false,
          compilationTimeMs: 0,
          diagnostics: [message],
        },
        error: message,
      };
    }
  }

  /**
   * Translates a natural language character action description into an AnimationIntent
   * with standardized intent names, priority tags, and root motion velocity.
   */
  public async synthesizeAnimationIntent(
    description: string,
    genre: GenreTemplate = GenreTemplate.GENRE_GENERIC,
    options?: SynthesizeIntentOptions
  ): Promise<AnimationIntent> {
    const genreName =
      Object.entries(GenreTemplate).find(([_, v]) => v === genre)?.[0] ?? String(genre);

    const promptMessages: ChatMessage[] = [
      {
        role: "system",
        content: `You are the AI-to-Rig Animation Synthesizer for mcp-physics-bridge.
Resolve natural language player action descriptions into standardized AnimationIntent JSON objects.
Return ONLY valid JSON matching this schema:
{
  "intentName": string (e.g. "Idle", "Walk", "Run", "Sprint", "Jump", "DoubleJump", "WallSlide", "AimDownSights", "Attack", "Dash"),
  "priority": number (0 to 100, where 100 is highest priority like death or hit_reaction),
  "desiredVelocity": number (nominal target root motion speed in m/s),
  "intensity": number (0.0 to 1.0),
  "layer": number (0 = Full Body, 1 = Lower Body, 2 = Upper Body, 3 = Additive),
  "priorityTags": string[] (e.g. ["uninterruptible", "root_motion_lock", "combat"]),
  "blendTransitionDuration": number (blend duration in seconds, e.g. 0.2)
}`,
      },
      {
        role: "user",
        content: `Action description: "${description}"
Genre Template: ${genreName}
Current Velocity: ${options?.currentVelocity ?? 0} m/s
On Ground: ${options?.onGround !== false}`,
      },
    ];

    const response = await this.chat(promptMessages, options);
    const jsonStr = this.extractJson(response.content);

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        intentName: String(parsed.intentName || "Idle"),
        priority: Number(parsed.priority ?? 10),
        desiredVelocity: Number(parsed.desiredVelocity ?? 0.0),
        intensity: Number(parsed.intensity ?? 1.0),
        layer:
          parsed.layer !== undefined
            ? (Number(parsed.layer) as AnimationLayer)
            : AnimationLayer.LAYER_FULL_BODY,
        priorityTags: Array.isArray(parsed.priorityTags) ? parsed.priorityTags : [],
        blendTransitionDuration: Number(parsed.blendTransitionDuration ?? 0.2),
      };
    } catch {
      // Fallback intent if JSON parse fails
      return {
        intentName: "Idle",
        priority: 0,
        desiredVelocity: 0.0,
        intensity: 1.0,
        layer: AnimationLayer.LAYER_FULL_BODY,
        priorityTags: [],
        blendTransitionDuration: 0.2,
      };
    }
  }

  // --- Internal Provider Handlers ---

  private async handleOpenAIChat(
    messages: ChatMessage[],
    options: ChatCompletionOptions | undefined,
    provider: ByokLlmProvider
  ): Promise<ChatCompletionResult> {
    const fetchImpl = this.customFetch || fetch;
    const endpoint = this.getEffectiveEndpoint(provider, options);
    const apiKey = this.getEffectiveApiKey(options);
    const model = this.getEffectiveModel(provider, options);
    const timeoutMs = options?.timeoutMs ?? this.config.byokTimeoutMs ?? 15000;

    const url = endpoint.endsWith("/chat/completions")
      ? endpoint
      : `${endpoint.replace(/\/+$/, "")}/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    };

    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const body = JSON.stringify({
      model,
      messages,
      temperature: options?.temperature ?? this.config.byokDefaultTemperature ?? 0.2,
      max_tokens: options?.maxTokens ?? this.config.byokMaxTokens ?? 2048,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenAI API request failed (${response.status} ${response.statusText}): ${errorText}`
        );
      }

      const json: any = await response.json();
      const choice = json.choices?.[0];
      const content = choice?.message?.content || "";

      return {
        content,
        model: json.model || model,
        provider,
        usage: json.usage
          ? {
              promptTokens: json.usage.prompt_tokens ?? 0,
              completionTokens: json.usage.completion_tokens ?? 0,
              totalTokens: json.usage.total_tokens ?? 0,
            }
          : undefined,
        rawResponse: json,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  private async handleAnthropicChat(
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const fetchImpl = this.customFetch || fetch;
    const endpoint = this.getEffectiveEndpoint("anthropic", options);
    const apiKey = this.getEffectiveApiKey(options);
    const model = this.getEffectiveModel("anthropic", options);
    const timeoutMs = options?.timeoutMs ?? this.config.byokTimeoutMs ?? 15000;

    const url = endpoint.endsWith("/messages")
      ? endpoint
      : `${endpoint.replace(/\/+$/, "")}/messages`;

    // Extract system messages for Anthropic API
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(options?.headers || {}),
    };

    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    const payload: any = {
      model,
      messages: conversationMessages,
      max_tokens: options?.maxTokens ?? this.config.byokMaxTokens ?? 2048,
      temperature: options?.temperature ?? this.config.byokDefaultTemperature ?? 0.2,
    };

    if (systemPrompt) {
      payload.system = systemPrompt;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Anthropic API request failed (${response.status} ${response.statusText}): ${errorText}`
        );
      }

      const json: any = await response.json();
      const content = json.content?.[0]?.text || "";

      return {
        content,
        model: json.model || model,
        provider: "anthropic",
        usage: json.usage
          ? {
              promptTokens: json.usage.input_tokens ?? 0,
              completionTokens: json.usage.output_tokens ?? 0,
              totalTokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0),
            }
          : undefined,
        rawResponse: json,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  private handleMockChat(
    messages: ChatMessage[],
    _options?: ChatCompletionOptions
  ): ChatCompletionResult {
    const userMessage = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const lower = userMessage.toLowerCase();

    // 1. Check if generating or repairing physics kernel
    if (lower.includes("fix the following") || lower.includes("reflective error logs") || lower.includes("repair")) {
      const mockRepaired = `
import { Vector3 } from "./math/vector3";
import { Quaternion } from "./math/quaternion";

// Repaired physics step with bounded kinematic constraints
export function stepPhysics(dt: f32): f32 {
  let pos = new Vector3(0.0, 5.0, 0.0);
  let vel = new Vector3(0.0, -9.81, 0.0);
  
  // Safe bounded integration
  let safeDt: f32 = dt > 0.1 ? f32(0.1) : (dt < 0.0 ? f32(0.0) : dt);
  let nextPos = pos.add(vel.scale(safeDt));
  
  // Ground clamp
  if (nextPos.y < 0.0) {
    nextPos.y = 0.0;
  }
  return nextPos.y;
}
`.trim();

      return {
        content: `Here is the repaired AssemblyScript physics kernel:\n\`\`\`typescript\n${mockRepaired}\n\`\`\``,
        model: "mock-physics-router",
        provider: "mock",
      };
    }

    if (
      lower.includes("generate a deterministic assemblyscript physics module") ||
      lower.includes("physics kernel") ||
      lower.includes("export function")
    ) {
      const mockCode = `
import { Vector3 } from "./math/vector3";
import { Quaternion } from "./math/quaternion";

export function stepPhysics(dt: f32): f32 {
  let pos = new Vector3(0.0, 10.0, 0.0);
  let vel = new Vector3(0.0, -9.81, 0.0);
  let nextPos = pos.add(vel.scale(dt));
  if (nextPos.y < 0.0) {
    nextPos.y = 0.0;
  }
  return nextPos.y;
}
`.trim();

      return {
        content: `Here is the generated deterministic AssemblyScript physics module:\n\`\`\`typescript\n${mockCode}\n\`\`\``,
        model: "mock-physics-router",
        provider: "mock",
      };
    }

    // 2. Check if synthesizing animation intent
    if (lower.includes("animationintent json") || lower.includes("action description:")) {
      let intentName = "Idle";
      let desiredVelocity = 0.0;
      let priority = 10;
      let layer: AnimationLayer = AnimationLayer.LAYER_FULL_BODY;
      let priorityTags: string[] = [];

      if (lower.includes("sprint") || lower.includes("run fast")) {
        intentName = "Sprint";
        desiredVelocity = 8.0;
        priority = 30;
      } else if (lower.includes("run") || lower.includes("jog")) {
        intentName = "Run";
        desiredVelocity = 5.0;
        priority = 25;
      } else if (lower.includes("walk") || lower.includes("stroll")) {
        intentName = "Walk";
        desiredVelocity = 2.0;
        priority = 20;
      } else if (lower.includes("jump") || lower.includes("leap")) {
        intentName = "Jump";
        desiredVelocity = 4.0;
        priority = 50;
        priorityTags = ["aerial"];
      } else if (lower.includes("dash") || lower.includes("dodge")) {
        intentName = "Dash";
        desiredVelocity = 12.0;
        priority = 60;
        priorityTags = ["uninterruptible"];
      } else if (lower.includes("aim") || lower.includes("shoot") || lower.includes("fire")) {
        intentName = "AimDownSights";
        desiredVelocity = 1.0;
        priority = 40;
        layer = AnimationLayer.LAYER_UPPER_BODY;
      }

      const mockJson = JSON.stringify({
        intentName,
        priority,
        desiredVelocity,
        intensity: 1.0,
        layer,
        priorityTags,
        blendTransitionDuration: 0.2,
      });

      return {
        content: mockJson,
        model: "mock-physics-router",
        provider: "mock",
      };
    }

    // Default mock response
    return {
      content: `[mcp-physics-bridge BYOK Mock] Successfully processed prompt: "${userMessage.slice(0, 80)}..."`,
      model: "mock-physics-router",
      provider: "mock",
    };
  }

  // --- Helper parsing methods ---

  private extractCodeBlock(text: string): string {
    const codeBlockMatch =
      text.match(/```(?:typescript|ts|assemblyscript|as)?\s*\n([\s\S]*?)```/) ||
      text.match(/```([\s\S]*?)```/);

    if (codeBlockMatch && codeBlockMatch[1]) {
      return codeBlockMatch[1].trim();
    }

    // If no code block fence but looks like raw source code
    if (text.includes("export function") || text.includes("import { Vector3 }")) {
      return text.trim();
    }

    return "";
  }

  private extractJson(text: string): string {
    const jsonMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
    if (jsonMatch && jsonMatch[1]) {
      return jsonMatch[1].trim();
    }

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1).trim();
    }

    return text.trim();
  }
}
