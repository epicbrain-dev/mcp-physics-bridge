import { describe, it, expect } from "vitest";
import { PhysicsBridgeService } from "../../src/index.js";
import { BridgeConfig, defaultConfig } from "../../src/config.js";

describe("PhysicsBridgeService (Bootstrap & Shutdown Lifecycle Integration)", () => {
  it("initializes, bootstraps all servers, and performs graceful shutdown", async () => {
    const testConfig: BridgeConfig = {
      ...defaultConfig,
      grpcPort: 50075,
      grpcWebPort: 50076,
      wsPort: 8097,
      sqliteVectorPath: ":memory:",
      byokLlmProvider: "mock",
    };

    const bridge = new PhysicsBridgeService(testConfig);

    expect(bridge.authorityManager).toBeDefined();
    expect(bridge.vectorStore).toBeDefined();
    expect(bridge.keyframeIndexer).toBeDefined();
    expect(bridge.grpcServer).toBeDefined();
    expect(bridge.grpcWebBridge).toBeDefined();
    expect(bridge.webSocketServer).toBeDefined();
    expect(bridge.mcpServer).toBeDefined();

    // Vector store is not open before bootstrap
    expect(bridge.vectorStore.isOpen()).toBe(false);

    // Bootstrap all services
    await bridge.bootstrap();

    // Verify all subsystems are running
    expect(bridge.vectorStore.isOpen()).toBe(true);
    expect(bridge.grpcServer.getStatus().isRunning).toBe(true);
    expect(bridge.grpcServer.getStatus().port).toBe(testConfig.grpcPort);

    expect(bridge.grpcWebBridge.getStatus().isRunning).toBe(true);
    expect(bridge.grpcWebBridge.getStatus().port).toBe(testConfig.grpcWebPort);

    expect(bridge.webSocketServer.getStatus().isRunning).toBe(true);
    expect(bridge.webSocketServer.getStatus().port).toBe(testConfig.wsPort);

    expect(bridge.mcpServer.getStatus().isRunning).toBe(true);
    expect(bridge.mcpServer.getStatus().byokProvider).toBe("mock");

    // Graceful shutdown
    await bridge.shutdown();

    // Verify all subsystems stopped cleanly
    expect(bridge.grpcServer.getStatus().isRunning).toBe(false);
    expect(bridge.grpcWebBridge.getStatus().isRunning).toBe(false);
    expect(bridge.webSocketServer.getStatus().isRunning).toBe(false);
    expect(bridge.mcpServer.getStatus().isRunning).toBe(false);
    expect(bridge.vectorStore.isOpen()).toBe(false);
  });
});
