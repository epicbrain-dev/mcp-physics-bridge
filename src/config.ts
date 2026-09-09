import crypto from "crypto";
import fs from "fs";
import path from "path";
import { z } from "zod";

export type ByokLlmProvider = "openai" | "anthropic" | "gemini" | "ollama" | "custom" | "mock";
export type NodeEnvironment = "development" | "production" | "test";

export interface BridgeConfig {
  nodeEnv: NodeEnvironment;
  grpcPort: number;
  grpcWebPort: number;
  wsPort: number;
  wsAuthToken: string;
  allowAnonymousLocalInDev: boolean;
  corsAllowedOrigins: string[];
  maxWsPayloadBytes: number;
  maxWsClients: number;
  maxHttpBodySizeBytes: number;
  sqliteVectorPath: string;
  targetFps: number;
  maxWasmMemoryPages: number;
  wasmExecutionTimeoutMs: number;
  enableTls: boolean;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  byokLlmApiKey?: string;
  byokLlmEndpoint?: string;
  byokLlmProvider?: ByokLlmProvider;
  byokLlmModel?: string;
  byokDefaultTemperature?: number;
  byokMaxTokens?: number;
  byokTimeoutMs?: number;
}

/**
 * Zod validation schema for runtime configuration validation.
 */
export const BridgeConfigSchema = z.object({
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  grpcPort: z.number().int().min(1024).max(65535).default(50051),
  grpcWebPort: z.number().int().min(1024).max(65535).default(50052),
  wsPort: z.number().int().min(1024).max(65535).default(8080),
  wsAuthToken: z.string().min(1),
  allowAnonymousLocalInDev: z.boolean().default(true),
  corsAllowedOrigins: z.array(z.string()).default(["*"]),
  maxWsPayloadBytes: z.number().int().positive().default(5 * 1024 * 1024), // 5 MB
  maxWsClients: z.number().int().positive().default(1000),
  maxHttpBodySizeBytes: z.number().int().positive().default(10 * 1024 * 1024), // 10 MB
  sqliteVectorPath: z.string().default("./data/physics_keyframes.sqlite"),
  targetFps: z.number().int().positive().default(60),
  maxWasmMemoryPages: z.number().int().positive().default(4), // 256 KB
  wasmExecutionTimeoutMs: z.number().positive().default(16),
  enableTls: z.boolean().default(false),
  tlsCertPath: z.string().optional(),
  tlsKeyPath: z.string().optional(),
  byokLlmApiKey: z.string().optional(),
  byokLlmEndpoint: z.string().optional(),
  byokLlmProvider: z.enum(["openai", "anthropic", "gemini", "ollama", "custom", "mock"]).default("mock"),
  byokLlmModel: z.string().default("gpt-4o"),
  byokDefaultTemperature: z.number().min(0).max(2).default(0.2),
  byokMaxTokens: z.number().int().positive().default(2048),
  byokTimeoutMs: z.number().positive().default(15000),
});

/**
 * Resolves the WebSocket authentication token dynamically:
 * 1. Returns process.env.MCP_PHYSICS_WS_TOKEN if set.
 * 2. In test environment, returns a stable test token to keep tests deterministic.
 * 3. Otherwise, generates a 256-bit cryptographically secure token and writes to data/.runtime_token.
 */
export function resolveWsAuthToken(): string {
  if (process.env.MCP_PHYSICS_WS_TOKEN && process.env.MCP_PHYSICS_WS_TOKEN.trim().length > 0) {
    return process.env.MCP_PHYSICS_WS_TOKEN.trim();
  }

  // In testing environment, return a deterministic test token
  if (process.env.NODE_ENV === "test") {
    return "test-token-auto-generated";
  }

  // Dynamically generate a 256-bit secure ephemeral token (zero hardcoding)
  const ephemeralToken = crypto.randomBytes(32).toString("hex");

  // Attempt to persist to data/.runtime_token for seamless engine discovery
  try {
    const dataDir = path.resolve(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const tokenPath = path.join(dataDir, ".runtime_token");
    fs.writeFileSync(tokenPath, ephemeralToken, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Non-fatal if filesystem is read-only (e.g. read-only container)
  }

  return ephemeralToken;
}

/**
 * Parses comma-separated CORS origins from environment variable.
 */
export function parseCorsAllowedOrigins(raw?: string, nodeEnv: NodeEnvironment = "development"): string[] {
  if (!raw || raw.trim().length === 0) {
    return nodeEnv === "production" ? [] : ["*"];
  }
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Loads and validates configuration from environment variables with safe defaults.
 */
export function loadConfigFromEnv(): BridgeConfig {
  const nodeEnv: NodeEnvironment =
    (process.env.NODE_ENV as NodeEnvironment) || "development";

  const rawConfig = {
    nodeEnv,
    grpcPort: parseInt(process.env.MCP_GRPC_PORT || "50051", 10),
    grpcWebPort: parseInt(process.env.MCP_GRPC_WEB_PORT || "50052", 10),
    wsPort: parseInt(process.env.MCP_WS_PORT || "8080", 10),
    wsAuthToken: resolveWsAuthToken(),
    allowAnonymousLocalInDev: nodeEnv !== "production",
    corsAllowedOrigins: parseCorsAllowedOrigins(process.env.MCP_CORS_ALLOWED_ORIGINS, nodeEnv),
    maxWsPayloadBytes: parseInt(process.env.MCP_MAX_WS_PAYLOAD_BYTES || `${5 * 1024 * 1024}`, 10),
    maxWsClients: parseInt(process.env.MCP_MAX_WS_CLIENTS || "1000", 10),
    maxHttpBodySizeBytes: parseInt(process.env.MCP_MAX_HTTP_BODY_BYTES || `${10 * 1024 * 1024}`, 10),
    sqliteVectorPath: process.env.MCP_VECTOR_DB_PATH || "./data/physics_keyframes.sqlite",
    targetFps: parseInt(process.env.MCP_TARGET_FPS || "60", 10),
    maxWasmMemoryPages: parseInt(process.env.MCP_MAX_WASM_PAGES || "4", 10),
    wasmExecutionTimeoutMs: parseInt(process.env.MCP_WASM_TIMEOUT_MS || "16", 10),
    enableTls: process.env.MCP_ENABLE_TLS === "true",
    tlsCertPath: process.env.MCP_TLS_CERT_PATH,
    tlsKeyPath: process.env.MCP_TLS_KEY_PATH,
    byokLlmApiKey: process.env.LLM_API_KEY,
    byokLlmEndpoint: process.env.LLM_API_ENDPOINT,
    byokLlmProvider: (process.env.LLM_PROVIDER as ByokLlmProvider) || "mock",
    byokLlmModel: process.env.LLM_MODEL || "gpt-4o",
    byokDefaultTemperature: parseFloat(process.env.LLM_TEMPERATURE || "0.2"),
    byokMaxTokens: parseInt(process.env.LLM_MAX_TOKENS || "2048", 10),
    byokTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || "15000", 10),
  };

  return BridgeConfigSchema.parse(rawConfig);
}

export const defaultConfig: BridgeConfig = loadConfigFromEnv();
