import { WebSocketServer, WebSocket, RawData } from "ws";
import { IncomingMessage } from "http";
import crypto from "crypto";
import * as protoLoader from "@grpc/proto-loader";
import * as grpc from "@grpc/grpc-js";
import path from "path";
import { fileURLToPath } from "url";
import { BridgeConfig } from "../config.js";
import { PhysicsFrameSoA, EngineMode, PhysicsValidationResponse } from "../proto/index.js";
import { StateAuthorityManager } from "../validation/authority_manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_ROOT = path.resolve(__dirname, "../../proto");

export interface WebSocketServerStatus {
  isRunning: boolean;
  port: number;
  clientCount: number;
  framesProcessed: number;
}

interface AuthenticatedSocket extends WebSocket {
  isAlive: boolean;
}

/**
 * WebPhysicsWebSocketServer provides a low-latency 60 FPS continuous physics transport
 * for web engines (e.g. Phaser).
 * Hardened with:
 * - Constant-time timing-safe token authentication (timingSafeEqual)
 * - Cross-Site WebSocket Hijacking (CSWSH) origin defense
 * - Payload size boundaries to prevent memory exhaustion
 * - Active connection limits and graceful connection draining
 */
export class WebPhysicsWebSocketServer {
  private wss?: WebSocketServer;
  private isRunning: boolean = false;
  private framesProcessed: number = 0;
  private heartbeatInterval?: NodeJS.Timeout;
  private protoService?: any;
  private activeSockets = new Set<AuthenticatedSocket>();

  constructor(
    private readonly config: BridgeConfig,
    private readonly authorityManager: StateAuthorityManager = new StateAuthorityManager()
  ) {}

  /**
   * Validates incoming handshake token using constant-time comparison to prevent timing attacks.
   */
  public validateHandshakeToken(token: string | undefined): boolean {
    if (!token || typeof token !== "string") return false;
    const expected = this.config.wsAuthToken;
    if (!expected || typeof expected !== "string") return false;

    // Use constant-time comparison over SHA-256 digests to prevent timing attacks
    const a = crypto.createHash("sha256").update(token).digest();
    const b = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Validates client origin against allowed CORS origins to prevent CSWSH.
   */
  public validateOrigin(req: IncomingMessage): boolean {
    const origin = req.headers["origin"];
    if (!origin) return true; // Non-browser clients (native games, bots, CLI)

    const allowed = this.config.corsAllowedOrigins;
    if (allowed.includes("*")) return true;

    if (this.config.nodeEnv !== "production") {
      try {
        const parsed = new URL(origin);
        if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
          return true;
        }
      } catch {
        return false;
      }
    }

    return allowed.includes(origin);
  }

  /**
   * Extracts authentication token from query params, Authorization header,
   * Sec-WebSocket-Protocol, or x-auth-token header.
   */
  public extractToken(req: IncomingMessage): string | undefined {
    // 1. Check URL query parameters: ?token=...
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const queryToken = url.searchParams.get("token");
      if (queryToken) return queryToken;
    } catch {
      // Fall through to headers
    }

    // 2. Check Authorization header: Bearer <token>
    const authHeader = req.headers["authorization"];
    if (authHeader) {
      const parts = authHeader.split(" ");
      if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
        return parts[1];
      }
      return authHeader;
    }

    // 3. Check Sec-WebSocket-Protocol header: e.g. token.<token> or <token>
    const subproto = req.headers["sec-websocket-protocol"];
    if (subproto) {
      const protocols = subproto.split(",").map((p) => p.trim());
      for (const proto of protocols) {
        if (proto.startsWith("token.")) {
          return proto.substring(6);
        }
      }
      if (protocols.length === 1 && !protocols[0].includes("/")) {
        return protocols[0];
      }
    }

    // 4. Check custom header
    const customHeader = req.headers["x-auth-token"];
    if (typeof customHeader === "string") {
      return customHeader;
    }

    return undefined;
  }

  /**
   * Normalizes incoming raw frame object into typed PhysicsFrameSoA.
   */
  public normalizeFrame(raw: any): PhysicsFrameSoA {
    const mapFloats = (arr?: any[]): number[] =>
      arr
        ? Array.from(arr).map((v) =>
            v === null || v === undefined || v === "NaN" ? NaN : Number(v)
          )
        : [];

    return {
      frameId: BigInt(raw.frameId ?? raw.frame_id ?? 0),
      timestampNs: BigInt(raw.timestampNs ?? raw.timestamp_ns ?? 0),
      deltaTime: Number(raw.deltaTime ?? raw.delta_time ?? 0.016667),
      mode: Number(raw.mode ?? 0) as EngineMode,
      entityIds: raw.entityIds ?? raw.entity_ids ?? [],
      parentIds: raw.parentIds ?? raw.parent_ids ? Array.from(raw.parentIds ?? raw.parent_ids).map(Number) : undefined,
      posX: mapFloats(raw.posX ?? raw.pos_x),
      posY: mapFloats(raw.posY ?? raw.pos_y),
      posZ: mapFloats(raw.posZ ?? raw.pos_z),
      velX: mapFloats(raw.velX ?? raw.vel_x),
      velY: mapFloats(raw.velY ?? raw.vel_y),
      velZ: mapFloats(raw.velZ ?? raw.vel_z),
      rotX: mapFloats(raw.rotX ?? raw.rot_x),
      rotY: mapFloats(raw.rotY ?? raw.rot_y),
      rotZ: mapFloats(raw.rotZ ?? raw.rot_z),
      rotW: mapFloats(raw.rotW ?? raw.rot_w),
      angVelX: (raw.angVelX?.length || raw.ang_vel_x?.length) ? mapFloats(raw.angVelX ?? raw.ang_vel_x) : undefined,
      angVelY: (raw.angVelY?.length || raw.ang_vel_y?.length) ? mapFloats(raw.angVelY ?? raw.ang_vel_y) : undefined,
      angVelZ: (raw.angVelZ?.length || raw.ang_vel_z?.length) ? mapFloats(raw.angVelZ ?? raw.ang_vel_z) : undefined,
      radii: raw.radii?.length ? mapFloats(raw.radii) : undefined,
      masses: raw.masses?.length ? mapFloats(raw.masses) : undefined,
    };
  }

  /**
   * Serializes a PhysicsFrameSoA into a JSON-safe object with arrays and string BigInts.
   */
  public serializeFrameJson(frame: PhysicsFrameSoA): any {
    return {
      frameId: frame.frameId.toString(),
      timestampNs: frame.timestampNs.toString(),
      deltaTime: frame.deltaTime,
      mode: frame.mode,
      entityIds: Array.from(frame.entityIds),
      parentIds: frame.parentIds ? Array.from(frame.parentIds) : undefined,
      posX: Array.from(frame.posX),
      posY: Array.from(frame.posY),
      posZ: Array.from(frame.posZ),
      velX: Array.from(frame.velX),
      velY: Array.from(frame.velY),
      velZ: Array.from(frame.velZ),
      rotX: Array.from(frame.rotX),
      rotY: Array.from(frame.rotY),
      rotZ: Array.from(frame.rotZ),
      rotW: Array.from(frame.rotW),
      angVelX: frame.angVelX ? Array.from(frame.angVelX) : undefined,
      angVelY: frame.angVelY ? Array.from(frame.angVelY) : undefined,
      angVelZ: frame.angVelZ ? Array.from(frame.angVelZ) : undefined,
      radii: frame.radii ? Array.from(frame.radii) : undefined,
      masses: frame.masses ? Array.from(frame.masses) : undefined,
    };
  }

  private serializeResponseJson(res: PhysicsValidationResponse): string {
    return JSON.stringify({
      frameId: res.frameId.toString(),
      statusCode: res.statusCode,
      errorMessage: res.errorMessage ?? "",
      failingEntityIds: res.failingEntityIds ?? [],
      frameErrorBitmask: res.frameErrorBitmask ?? 0,
      entityErrorBitmasks: res.entityErrorBitmasks ?? [],
      correctedFrame: res.correctedFrame ? this.serializeFrameJson(res.correctedFrame) : undefined,
    });
  }

  private async loadProtoSerializer(): Promise<void> {
    if (this.protoService) return;
    const pkgDef = await protoLoader.load(path.join(PROTO_ROOT, "physics_stream.proto"), {
      keepCase: false,
      longs: String,
      enums: Number,
      defaults: true,
      oneofs: true,
    });
    const loaded = grpc.loadPackageDefinition(pkgDef) as any;
    this.protoService = loaded.mcp.physics.PhysicsStreamingService.service;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    await this.loadProtoSerializer();

    this.wss = new WebSocketServer({
      port: this.config.wsPort,
      maxPayload: this.config.maxWsPayloadBytes ?? 5 * 1024 * 1024,
    });

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const socket = ws as AuthenticatedSocket;
      socket.isAlive = true;

      // 1. Concurrency limit check
      if (this.config.maxWsClients && this.activeSockets.size >= this.config.maxWsClients) {
        socket.close(1013, "Server busy: Max connections reached");
        return;
      }

      // 2. CSWSH Defense: Validate Origin
      if (!this.validateOrigin(req)) {
        socket.close(1008, "Unauthorized: Forbidden Origin");
        return;
      }

      // 3. CSWSH Defense: Validate handshake token
      const token = this.extractToken(req);
      if (!this.validateHandshakeToken(token)) {
        socket.close(1008, "Unauthorized: Invalid or missing token");
        return;
      }

      this.activeSockets.add(socket);

      socket.on("close", () => {
        this.activeSockets.delete(socket);
      });

      // Heartbeat ping-pong
      socket.on("pong", () => {
        socket.isAlive = true;
      });

      // 4. High-frequency 60 FPS frame transport
      socket.on("message", (data: RawData, isBinary: boolean) => {
        try {
          this.framesProcessed++;
          let normalizedFrame: PhysicsFrameSoA;
          const isJson = !isBinary || (Buffer.isBuffer(data) && data[0] === 0x7b);

          if (isJson) {
            const raw = JSON.parse(data.toString());
            normalizedFrame = this.normalizeFrame(raw);
            const validationRes = this.authorityManager.validateFrame(normalizedFrame);
            socket.send(this.serializeResponseJson(validationRes));
          } else {
            // Binary Protobuf message
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            const raw = this.protoService.StreamPhysics.requestDeserialize(buffer);
            normalizedFrame = this.normalizeFrame(raw);
            const validationRes = this.authorityManager.validateFrame(normalizedFrame);

            const protoResObj = {
              frameId: validationRes.frameId.toString(),
              statusCode: validationRes.statusCode,
              errorMessage: validationRes.errorMessage ?? "",
              failingEntityIds: validationRes.failingEntityIds ?? [],
              frameErrorBitmask: validationRes.frameErrorBitmask ?? 0,
              entityErrorBitmasks: validationRes.entityErrorBitmasks ?? [],
              correctedFrame: validationRes.correctedFrame ? this.serializeFrameJson(validationRes.correctedFrame) : undefined,
            };

            const encoded = this.protoService.StreamPhysics.responseSerialize(protoResObj);
            socket.send(encoded, { binary: true });
          }
        } catch (err: any) {
          socket.send(
            JSON.stringify({
              error: err?.message ?? "Failed to process physics frame",
            })
          );
        }
      });
    });

    // Liveness heartbeat monitor every 15 seconds
    this.heartbeatInterval = setInterval(() => {
      if (!this.wss) return;
      this.wss.clients.forEach((client) => {
        const sock = client as AuthenticatedSocket;
        if (!sock.isAlive) {
          this.activeSockets.delete(sock);
          sock.terminate();
          return;
        }
        sock.isAlive = false;
        sock.ping();
      });
    }, 15000);

    this.isRunning = true;
    console.log(
      `[WebSocket] 60 FPS physics WebSocket server listening on port ${this.config.wsPort} (Token Auth Enabled)`
    );
  }

  public async stop(): Promise<void> {
    if (!this.isRunning || !this.wss) {
      this.isRunning = false;
      return;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    return new Promise<void>((resolve) => {
      // Gracefully close and drain all active sockets
      for (const client of this.activeSockets) {
        try {
          client.close(1000, "Server stopping");
          client.terminate();
        } catch {
          // Socket already closed
        }
      }
      this.activeSockets.clear();

      this.wss!.close(() => {
        this.isRunning = false;
        console.log("[WebSocket] Physics WebSocket server stopped");
        resolve();
      });
    });
  }

  public getStatus(): WebSocketServerStatus {
    return {
      isRunning: this.isRunning,
      port: this.config.wsPort,
      clientCount: this.activeSockets.size,
      framesProcessed: this.framesProcessed,
    };
  }
}
