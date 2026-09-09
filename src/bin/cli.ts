#!/usr/bin/env node

/**
 * mcp-physics-bridge CLI entrypoint
 *
 * Usage:
 *   npx mcp-physics-bridge [--stdio] [--port <wsPort>] [--grpc <grpcPort>] [--grpc-web <webPort>]
 *   npx mcp-physics-bridge --help
 *   npx mcp-physics-bridge --version
 */

import { PhysicsBridgeService } from "../index.js";
import { MCPPhysicsBridgeServer } from "../mcp/server.js";
import { loadConfigFromEnv, BridgeConfig, NodeEnvironment } from "../config.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const VERSION = "0.1.0";

const HELP_TEXT = `
mcp-physics-bridge - v${VERSION}
Engine-agnostic MCP middleware server bridging probabilistic AI reasoning with deterministic 60 FPS game physics.

USAGE:
  mcp-physics-bridge [OPTIONS]
  npx mcp-physics-bridge [OPTIONS]

MODES:
  --stdio                Run in stdio MCP mode (recommended for Claude Desktop, Cursor, Antigravity).
  --all                  Run full multi-protocol daemon (gRPC, gRPC-Web, WebSocket, MCP) [default].

OPTIONS:
  -p, --port <port>      WebSocket physics port (default: 8080 or $MCP_PHYSICS_WS_PORT)
  --grpc <port>          Native HTTP/2 gRPC streaming port (default: 50051 or $MCP_PHYSICS_GRPC_PORT)
  --grpc-web <port>      gRPC-Web proxy / metrics port (default: 50052 or $MCP_PHYSICS_GRPC_WEB_PORT)
  --env <env>            Environment mode: 'production' | 'development' (default: $NODE_ENV or development)
  --fps <number>         Target simulation tick rate (default: 60)
  -v, --version          Print version and exit
  -h, --help             Show this help message and exit

EXAMPLES:
  # Run stdio MCP server for Claude Desktop / Cursor
  npx mcp-physics-bridge --stdio

  # Run full multi-protocol daemon with custom ports
  npx mcp-physics-bridge --port 8085 --grpc 50055

  # Run in production mode with custom target FPS
  npx mcp-physics-bridge --env production --fps 120

AI CLIENT CONFIGURATION (Claude Desktop / Cursor):
  {
    "mcpServers": {
      "physics-bridge": {
        "command": "npx",
        "args": ["-y", "mcp-physics-bridge", "--stdio"],
        "env": {
          "MCP_PHYSICS_AUTHORITY_MODE": "playtest",
          "MCP_PHYSICS_BYOK_PROVIDER": "mock"
        }
      }
    }
  }
`;

function parseArgs(args: string[]): {
  stdio: boolean;
  help: boolean;
  version: boolean;
  wsPort?: number;
  grpcPort?: number;
  grpcWebPort?: number;
  env?: string;
  fps?: number;
} {
  const result: ReturnType<typeof parseArgs> = {
    stdio: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      result.help = true;
    } else if (arg === "-v" || arg === "--version") {
      result.version = true;
    } else if (arg === "--stdio") {
      result.stdio = true;
    } else if (arg === "-p" || arg === "--port") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val)) result.wsPort = val;
    } else if (arg === "--grpc") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val)) result.grpcPort = val;
    } else if (arg === "--grpc-web") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val)) result.grpcWebPort = val;
    } else if (arg === "--env") {
      result.env = args[++i];
    } else if (arg === "--fps") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val)) result.fps = val;
    }
  }

  return result;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (flags.version) {
    console.log(`mcp-physics-bridge v${VERSION}`);
    process.exit(0);
  }

  const baseConfig = loadConfigFromEnv();
  const config: BridgeConfig = {
    ...baseConfig,
    ...(flags.wsPort ? { wsPort: flags.wsPort } : {}),
    ...(flags.grpcPort ? { grpcPort: flags.grpcPort } : {}),
    ...(flags.grpcWebPort ? { grpcWebPort: flags.grpcWebPort } : {}),
    ...(flags.env && (flags.env === "production" || flags.env === "development" || flags.env === "test")
      ? { nodeEnv: flags.env as NodeEnvironment }
      : {}),
    ...(flags.fps ? { targetFps: flags.fps } : {}),
  };

  if (flags.stdio) {
    // Stdio MCP mode: redirect console output to stderr so stdout is reserved for JSON-RPC
    console.log = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");
    console.info = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");

    const mcpServer = new MCPPhysicsBridgeServer(config);
    const transport = new StdioServerTransport();

    process.on("SIGINT", async () => {
      await mcpServer.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await mcpServer.stop();
      process.exit(0);
    });

    await mcpServer.start(transport);
    process.stderr.write("[MCP] Stdio transport connected. Listening for AI tool calls...\n");
  } else {
    // Full multi-protocol daemon mode
    const service = new PhysicsBridgeService(config);

    const handleShutdown = async (sig: string) => {
      console.log(`\nReceived ${sig}. Shutting down mcp-physics-bridge daemon...`);
      try {
        await service.shutdown();
        process.exit(0);
      } catch (err) {
        console.error(`Error during ${sig} shutdown:`, err);
        process.exit(1);
      }
    };

    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));

    await service.bootstrap();
  }
}

main().catch((err) => {
  console.error("[Fatal] CLI startup error:", err);
  process.exit(1);
});
