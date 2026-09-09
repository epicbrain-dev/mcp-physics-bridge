import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { BridgeConfig, defaultConfig } from "../config.js";
import { StateAuthorityManager } from "../validation/authority_manager.js";
import { SQLiteVectorStore, KeyframeIndexer } from "../memory/index.js";
import { InMemoryAssemblyScriptCompiler } from "../sandbox/compiler.js";
import { WasmContainer } from "../sandbox/wasm_container.js";
import { DualPayloadVerifier } from "../sandbox/dual_payload.js";
import { AnimationSynthesizer } from "../animation/synthesizer.js";
import { ByokLlmRouter } from "./llm/byok_router.js";
import { DataTranslationLayer } from "../ecs/data_translator.js";
import {
  registerPhysicsTools,
  PHYSICS_TOOLS,
  registerInspectionTools,
  INSPECTION_TOOLS,
  registerAnimationTools,
  registerLlmTools,
} from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts, GAME_PHYSICS_SYSTEM_PROMPT } from "./prompts/index.js";

export interface MCPPhysicsBridgeServerOptions {
  authorityManager?: StateAuthorityManager;
  vectorStore?: SQLiteVectorStore;
  keyframeIndexer?: KeyframeIndexer;
  compiler?: InMemoryAssemblyScriptCompiler;
  wasmContainer?: WasmContainer;
  verifier?: DualPayloadVerifier;
  byokRouter?: ByokLlmRouter;
  animationSynthesizer?: AnimationSynthesizer;
  dataTranslator?: DataTranslationLayer;
}

/**
 * MCPPhysicsBridgeServer wraps the Model Context Protocol SDK interface,
 * exposing physics execution, inspection, verification, and BYOK LLM tools to AI models.
 */
export class MCPPhysicsBridgeServer {
  public readonly mcpServer: McpServer;
  public readonly authorityManager: StateAuthorityManager;
  public readonly vectorStore: SQLiteVectorStore;
  public readonly keyframeIndexer: KeyframeIndexer;
  public readonly compiler: InMemoryAssemblyScriptCompiler;
  public readonly wasmContainer: WasmContainer;
  public readonly verifier: DualPayloadVerifier;
  public readonly byokRouter: ByokLlmRouter;
  public readonly animationSynthesizer: AnimationSynthesizer;
  public readonly dataTranslator: DataTranslationLayer;

  private isRunning: boolean = false;
  private isConnected: boolean = false;

  constructor(
    private readonly _config: BridgeConfig = defaultConfig,
    options?: MCPPhysicsBridgeServerOptions
  ) {
    this.mcpServer = new McpServer({
      name: "mcp-physics-bridge",
      version: "0.1.0",
    });

    // Initialize or inherit subsystems
    this.authorityManager = options?.authorityManager ?? new StateAuthorityManager();
    this.vectorStore = options?.vectorStore ?? new SQLiteVectorStore(this._config);
    this.keyframeIndexer =
      options?.keyframeIndexer ?? new KeyframeIndexer(this.vectorStore);
    this.compiler = options?.compiler ?? new InMemoryAssemblyScriptCompiler();
    this.wasmContainer = options?.wasmContainer ?? new WasmContainer(this._config);
    this.verifier = options?.verifier ?? new DualPayloadVerifier();
    this.animationSynthesizer =
      options?.animationSynthesizer ?? new AnimationSynthesizer();
    this.dataTranslator = options?.dataTranslator ?? new DataTranslationLayer();

    this.byokRouter =
      options?.byokRouter ??
      new ByokLlmRouter(this._config, {
        compiler: this.compiler,
        wasmContainer: this.wasmContainer,
      });

    // Register all tools, resources, and prompts
    this.registerAllCapabilities();
  }

  public get config(): BridgeConfig {
    return this._config;
  }

  private registerAllCapabilities(): void {
    // 1. Physics Tools
    registerPhysicsTools(this.mcpServer, {
      config: this._config,
      compiler: this.compiler,
      wasmContainer: this.wasmContainer,
      verifier: this.verifier,
      authorityManager: this.authorityManager,
    });

    // 2. Inspection & RAG Tools
    registerInspectionTools(this.mcpServer, {
      vectorStore: this.vectorStore,
      keyframeIndexer: this.keyframeIndexer,
      dataTranslator: this.dataTranslator,
    });

    // 3. Animation Synthesizer Tools
    registerAnimationTools(this.mcpServer, {
      synthesizer: this.animationSynthesizer,
    });

    // 4. BYOK LLM Generation & Repair Tools
    registerLlmTools(this.mcpServer, {
      byokRouter: this.byokRouter,
    });

    // 5. Resources under physics://
    registerResources(this.mcpServer, {
      config: this._config,
      vectorStore: this.vectorStore,
      authorityManager: this.authorityManager,
    });

    // 6. Prompts
    registerPrompts(this.mcpServer);
  }

  /**
   * Connects the MCP server to a given transport (e.g. InMemoryTransport or StdioServerTransport).
   */
  public async connect(transport: Transport): Promise<void> {
    await this.mcpServer.connect(transport);
    this.isRunning = true;
    this.isConnected = true;
    console.log("[MCP] Model Context Protocol server connected to transport");
  }

  /**
   * Starts the MCP server with an optional transport.
   */
  public async start(transport?: Transport): Promise<void> {
    if (transport) {
      await this.connect(transport);
    } else {
      this.isRunning = true;
      console.log("[MCP] Model Context Protocol Physics Bridge server ready");
    }
  }

  /**
   * Starts the MCP server using Stdio transport (for CLI or standard MCP clients).
   */
  public async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.connect(transport);
  }

  /**
   * Stops the MCP server and closes connections.
   */
  public async stop(): Promise<void> {
    if (this.isConnected) {
      await this.mcpServer.close();
      this.isConnected = false;
    }
    this.isRunning = false;
    console.log("[MCP] MCP server stopped");
  }

  public getMcpServer(): McpServer {
    return this.mcpServer;
  }

  public getAvailableTools(): unknown[] {
    return [
      ...PHYSICS_TOOLS,
      ...INSPECTION_TOOLS,
      {
        name: "synthesize_animation",
        description:
          "Synthesizes AI intent into blend weights and root motion scaling using genre templates and priority arbitration.",
      },
      {
        name: "generate_physics_kernel",
        description:
          "Uses BYOK LLM routing to generate, compile, and sandbox-test a deterministic AssemblyScript physics kernel.",
      },
      {
        name: "repair_physics_kernel",
        description:
          "Uses BYOK LLM routing and reflective memory (AST diff + error logs) to automatically fix a failing physics module.",
      },
    ];
  }

  public getSystemPrompt(): string {
    return GAME_PHYSICS_SYSTEM_PROMPT;
  }

  public getStatus(): MCPServerStatus {
    return {
      isRunning: this.isRunning,
      isConnected: this.isConnected,
      byokProvider: this.byokRouter.getEffectiveProvider(),
      targetFps: this._config.targetFps,
    };
  }
}

export interface MCPServerStatus {
  isRunning: boolean;
  isConnected: boolean;
  byokProvider: string;
  targetFps: number;
}
