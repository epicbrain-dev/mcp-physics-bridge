import { defaultConfig, BridgeConfig, loadConfigFromEnv } from "./config.js";
import { NativeEngineGrpcServer, GrpcServerStatus } from "./network/grpc_server.js";
import { GrpcWebBridge, GrpcWebBridgeStatus } from "./network/grpc_web_bridge.js";
import { WebPhysicsWebSocketServer, WebSocketServerStatus } from "./network/websocket_server.js";
import { MCPPhysicsBridgeServer, MCPServerStatus } from "./mcp/server.js";
import { SQLiteVectorStore, KeyframeIndexer } from "./memory/index.js";
import { StateAuthorityManager } from "./validation/authority_manager.js";

// Re-export all subsystems and public contracts
export * from "./config.js";
export * from "./proto/index.js";
export * from "./network/index.js";
export * from "./ecs/index.js";
export * from "./sandbox/index.js";
export * from "./validation/index.js";
export * from "./memory/index.js";
export * from "./animation/index.js";
export * from "./mcp/index.js";

export interface ServiceHealthStatus {
  status: "INITIALIZING" | "READY" | "SHUTTING_DOWN" | "STOPPED";
  uptimeSeconds: number;
  environment: string;
  grpc: GrpcServerStatus;
  grpcWeb: GrpcWebBridgeStatus;
  websocket: WebSocketServerStatus;
  mcp: MCPServerStatus;
}

/**
 * PhysicsBridgeService coordinates the unified lifecycle of all protocols,
 * authority validators, sandboxes, and vector context storage.
 */
export class PhysicsBridgeService {
  public readonly config: BridgeConfig;
  public readonly grpcServer: NativeEngineGrpcServer;
  public readonly grpcWebBridge: GrpcWebBridge;
  public readonly webSocketServer: WebPhysicsWebSocketServer;
  public readonly mcpServer: MCPPhysicsBridgeServer;
  public readonly vectorStore: SQLiteVectorStore;
  public readonly keyframeIndexer: KeyframeIndexer;
  public readonly authorityManager: StateAuthorityManager;

  private state: "INITIALIZING" | "READY" | "SHUTTING_DOWN" | "STOPPED" = "STOPPED";
  private bootTimestamp: number = 0;

  constructor(config: Partial<BridgeConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.authorityManager = new StateAuthorityManager();
    this.vectorStore = new SQLiteVectorStore(this.config);
    this.keyframeIndexer = new KeyframeIndexer(this.vectorStore);
    this.grpcServer = new NativeEngineGrpcServer(this.config, this.authorityManager);
    this.grpcWebBridge = new GrpcWebBridge(this.config);
    this.webSocketServer = new WebPhysicsWebSocketServer(this.config, this.authorityManager);
    this.mcpServer = new MCPPhysicsBridgeServer(this.config, {
      authorityManager: this.authorityManager,
      vectorStore: this.vectorStore,
      keyframeIndexer: this.keyframeIndexer,
    });
  }

  public async bootstrap(): Promise<void> {
    this.state = "INITIALIZING";
    console.log("=== Initializing mcp-physics-bridge Middleware Server ===");
    console.log(`[Config] Running in ${this.config.nodeEnv.toUpperCase()} mode (Target: ${this.config.targetFps} FPS)`);
    await this.vectorStore.initialize();
    await this.grpcServer.start();
    await this.grpcWebBridge.start();
    await this.webSocketServer.start();
    await this.mcpServer.start();
    this.bootTimestamp = Date.now();
    this.state = "READY";
    console.log("=== mcp-physics-bridge Middleware Server is Ready ===");
  }

  public async shutdown(): Promise<void> {
    if (this.state === "SHUTTING_DOWN" || this.state === "STOPPED") return;
    this.state = "SHUTTING_DOWN";
    console.log("=== Shutting down mcp-physics-bridge ===");
    await this.mcpServer.stop();
    await this.webSocketServer.stop();
    await this.grpcWebBridge.stop();
    await this.grpcServer.stop();
    await this.vectorStore.close();
    this.state = "STOPPED";
    console.log("=== mcp-physics-bridge shutdown complete ===");
  }

  public isReady(): boolean {
    return this.state === "READY";
  }

  public getStatus(): ServiceHealthStatus {
    const uptimeSeconds = this.bootTimestamp > 0 ? (Date.now() - this.bootTimestamp) / 1000 : 0;
    return {
      status: this.state,
      uptimeSeconds,
      environment: this.config.nodeEnv,
      grpc: this.grpcServer.getStatus(),
      grpcWeb: this.grpcWebBridge.getStatus(),
      websocket: this.webSocketServer.getStatus(),
      mcp: this.mcpServer.getStatus(),
    };
  }
}

// Auto-start and attach lifecycle signal handlers if executed directly as entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const service = new PhysicsBridgeService(loadConfigFromEnv());

  const handleTermination = async (signal: string) => {
    console.log(`\nReceived ${signal}. Gracefully stopping mcp-physics-bridge...`);
    try {
      await service.shutdown();
      process.exit(0);
    } catch (err) {
      console.error(`Error during graceful shutdown on ${signal}:`, err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => handleTermination("SIGINT"));
  process.on("SIGTERM", () => handleTermination("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    console.error("[Fatal] Unhandled Promise Rejection:", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("[Fatal] Uncaught Exception:", error);
    service.shutdown().finally(() => process.exit(1));
  });

  service.bootstrap().catch((err) => {
    console.error("Bootstrap failure:", err);
    process.exit(1);
  });
}
