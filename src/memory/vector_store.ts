import Database, { type Database as DatabaseType } from "better-sqlite3";
import fs from "fs";
import path from "path";
import { BridgeConfig, defaultConfig } from "../config.js";

export interface KeyframeVectorRecord {
  keyframeId: string;
  frameId: bigint;
  eventName: string;
  stateJson: string;
  embedding: number[];
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface KeyframeSearchResult extends KeyframeVectorRecord {
  similarity: number;
}

export interface FailureVectorRecord {
  failureId: string;
  moduleId: string;
  failedFrameId: bigint;
  errorLog: string;
  astDiff?: string;
  embedding: number[];
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface FailureSearchResult extends FailureVectorRecord {
  similarity: number;
}

export interface VectorStoreOptions {
  dbPath?: string;
  defaultDimension?: number;
  inMemory?: boolean;
}

/**
 * Converts a number[] or Float32Array into a Node.js Buffer for SQLite BLOB storage.
 */
export function float32ArrayToBuffer(arr: number[] | Float32Array): Buffer {
  const f32 = arr instanceof Float32Array ? arr : new Float32Array(arr);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/**
 * Converts a SQLite BLOB Buffer back into a Float32Array.
 */
export function bufferToFloat32Array(buf: Buffer): Float32Array {
  return new Float32Array(
    buf.buffer,
    buf.byteOffset,
    buf.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
}

/**
 * Normalizes a vector to unit length (L2 norm = 1.0).
 */
export function normalizeVector(vec: number[] | Float32Array): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0 || isNaN(norm)) {
    return Array.from(vec);
  }
  const result = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    result[i] = vec[i] / norm;
  }
  return result;
}

/**
 * SQLiteVectorStore manages keyframe embeddings and reflective context storage
 * using an embedded SQLite database to prevent AI context bloat.
 */
export class SQLiteVectorStore {
  private db?: DatabaseType;
  private isInitialized: boolean = false;
  private readonly dbPath: string;
  public readonly defaultDimension: number;

  constructor(
    private readonly _config: BridgeConfig,
    options?: VectorStoreOptions
  ) {
    const rawPath = options?.dbPath ?? _config?.sqliteVectorPath ?? defaultConfig.sqliteVectorPath ?? ":memory:";
    if (options?.inMemory || rawPath === ":memory:") {
      this.dbPath = ":memory:";
    } else {
      this.dbPath = path.resolve(rawPath);
    }
    this.defaultDimension = options?.defaultDimension || 128;
  }

  /**
   * Initializes the SQLite database, registers custom vector functions,
   * and creates required schema tables and indexes.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized && this.db) {
      return;
    }

    if (this.dbPath !== ":memory:") {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(this.dbPath);
    this.db.defaultSafeIntegers(true);

    // Performance optimizations: WAL journal mode and normal synchronous flag
    if (this.dbPath !== ":memory:") {
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
    }
    this.db.pragma("cache_size = -64000"); // 64 MB memory cache

    this.registerVectorFunctions();
    this.createSchema();

    this.isInitialized = true;
    console.log(`[Vector Store] SQLite-Vector database initialized at ${this.dbPath}`);
  }

  public isOpen(): boolean {
    return this.isInitialized && !!this.db && this.db.open;
  }

  public get config(): BridgeConfig {
    return this._config;
  }

  public getDatabasePath(): string {
    return this.dbPath;
  }

  private registerVectorFunctions(): void {
    if (!this.db) return;

    // 1. Cosine similarity function on Float32Array BLOBs
    this.db.function("cosine_similarity", { deterministic: true }, (aBuf: unknown, bBuf: unknown) => {
      if (!Buffer.isBuffer(aBuf) || !Buffer.isBuffer(bBuf)) return 0;
      if (aBuf.length === 0 || bBuf.length === 0) return 0;

      const a = new Float32Array(aBuf.buffer, aBuf.byteOffset, aBuf.byteLength / 4);
      const b = new Float32Array(bBuf.buffer, bBuf.byteOffset, bBuf.byteLength / 4);
      const len = Math.min(a.length, b.length);
      if (len === 0) return 0;

      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < len; i++) {
        const ai = a[i];
        const bi = b[i];
        dot += ai * bi;
        normA += ai * ai;
        normB += bi * bi;
      }

      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      if (denom === 0 || isNaN(denom)) return 0;
      return dot / denom;
    });

    // 2. L2 Euclidean distance function on Float32Array BLOBs
    this.db.function("l2_distance", { deterministic: true }, (aBuf: unknown, bBuf: unknown) => {
      if (!Buffer.isBuffer(aBuf) || !Buffer.isBuffer(bBuf)) return Infinity;
      const a = new Float32Array(aBuf.buffer, aBuf.byteOffset, aBuf.byteLength / 4);
      const b = new Float32Array(bBuf.buffer, bBuf.byteOffset, bBuf.byteLength / 4);
      const len = Math.min(a.length, b.length);
      if (len === 0) return Infinity;

      let sumSq = 0;
      for (let i = 0; i < len; i++) {
        const diff = a[i] - b[i];
        sumSq += diff * diff;
      }
      return Math.sqrt(sumSq);
    });

    // 3. Dot product function on Float32Array BLOBs
    this.db.function("dot_product", { deterministic: true }, (aBuf: unknown, bBuf: unknown) => {
      if (!Buffer.isBuffer(aBuf) || !Buffer.isBuffer(bBuf)) return 0;
      const a = new Float32Array(aBuf.buffer, aBuf.byteOffset, aBuf.byteLength / 4);
      const b = new Float32Array(bBuf.buffer, bBuf.byteOffset, bBuf.byteLength / 4);
      const len = Math.min(a.length, b.length);
      let dot = 0;
      for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
      }
      return dot;
    });
  }

  private createSchema(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS keyframes (
        keyframe_id TEXT PRIMARY KEY,
        frame_id INTEGER NOT NULL,
        event_name TEXT NOT NULL,
        state_json TEXT NOT NULL,
        embedding BLOB NOT NULL,
        dimension INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_keyframes_event_name ON keyframes(event_name);
      CREATE INDEX IF NOT EXISTS idx_keyframes_frame_id ON keyframes(frame_id);
      CREATE INDEX IF NOT EXISTS idx_keyframes_timestamp ON keyframes(timestamp);

      CREATE TABLE IF NOT EXISTS reflective_failures (
        failure_id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        failed_frame_id INTEGER NOT NULL,
        error_log TEXT NOT NULL,
        ast_diff TEXT,
        embedding BLOB NOT NULL,
        dimension INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_failures_module_id ON reflective_failures(module_id);
      CREATE INDEX IF NOT EXISTS idx_failures_frame_id ON reflective_failures(failed_frame_id);
    `);
  }

  private ensureOpen(): DatabaseType {
    if (!this.isInitialized || !this.db || !this.db.open) {
      throw new Error("SQLiteVectorStore is not initialized or has been closed");
    }
    return this.db;
  }

  /**
   * Inserts or replaces a keyframe record with its embedding.
   */
  public async insertKeyframe(record: KeyframeVectorRecord): Promise<void> {
    const db = this.ensureOpen();
    const embeddingBuffer = float32ArrayToBuffer(record.embedding);
    const metadataStr = record.metadata ? JSON.stringify(record.metadata) : null;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO keyframes (
        keyframe_id,
        frame_id,
        event_name,
        state_json,
        embedding,
        dimension,
        timestamp,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.keyframeId,
      record.frameId,
      record.eventName,
      record.stateJson,
      embeddingBuffer,
      record.embedding.length,
      record.timestamp,
      metadataStr
    );
  }

  /**
   * Retrieves a keyframe by its ID.
   */
  public async getKeyframe(keyframeId: string): Promise<KeyframeVectorRecord | null> {
    const db = this.ensureOpen();
    const stmt = db.prepare(`
      SELECT keyframe_id, frame_id, event_name, state_json, embedding, dimension, timestamp, metadata
      FROM keyframes
      WHERE keyframe_id = ?
    `);

    const row: any = stmt.get(keyframeId);
    if (!row) return null;

    return this.hydrateKeyframeRow(row);
  }

  /**
   * Searches for top-K keyframes most similar to a given query embedding using cosine similarity.
   */
  public async searchSimilarKeyframes(
    queryEmbedding: number[] | Float32Array,
    limit: number = 5,
    minSimilarity: number = -1.0,
    eventNameFilter?: string
  ): Promise<KeyframeSearchResult[]> {
    const db = this.ensureOpen();
    const queryBuffer = float32ArrayToBuffer(queryEmbedding);

    let sql = `
      SELECT keyframe_id, frame_id, event_name, state_json, embedding, dimension, timestamp, metadata,
             cosine_similarity(embedding, ?) AS similarity
      FROM keyframes
    `;

    const params: any[] = [queryBuffer];

    if (eventNameFilter) {
      sql += ` WHERE event_name = ?`;
      params.push(eventNameFilter);
    }

    sql += ` ORDER BY similarity DESC LIMIT ?`;
    params.push(Math.max(1, limit));

    const rows: any[] = db.prepare(sql).all(...params);

    return rows
      .filter((r) => r.similarity >= minSimilarity)
      .map((r) => ({
        ...this.hydrateKeyframeRow(r),
        similarity: Number(r.similarity),
      }));
  }

  /**
   * Retrieves keyframes matching a specific event name.
   */
  public async getKeyframesByEvent(
    eventName: string,
    limit: number = 50
  ): Promise<KeyframeVectorRecord[]> {
    const db = this.ensureOpen();
    const stmt = db.prepare(`
      SELECT keyframe_id, frame_id, event_name, state_json, embedding, dimension, timestamp, metadata
      FROM keyframes
      WHERE event_name = ?
      ORDER BY frame_id DESC
      LIMIT ?
    `);

    const rows: any[] = stmt.all(eventName, limit);
    return rows.map((r) => this.hydrateKeyframeRow(r));
  }

  /**
   * Retrieves keyframes within a range of frame IDs.
   */
  public async getKeyframesByFrameRange(
    startFrame: bigint,
    endFrame: bigint
  ): Promise<KeyframeVectorRecord[]> {
    const db = this.ensureOpen();
    const stmt = db.prepare(`
      SELECT keyframe_id, frame_id, event_name, state_json, embedding, dimension, timestamp, metadata
      FROM keyframes
      WHERE frame_id >= ? AND frame_id <= ?
      ORDER BY frame_id ASC
    `);

    const rows: any[] = stmt.all(startFrame, endFrame);
    return rows.map((r) => this.hydrateKeyframeRow(r));
  }

  /**
   * Returns the count of stored keyframes, optionally filtered by event name.
   */
  public async countKeyframes(eventName?: string): Promise<number> {
    const db = this.ensureOpen();
    if (eventName) {
      const stmt = db.prepare(`SELECT COUNT(*) as count FROM keyframes WHERE event_name = ?`);
      const row: any = stmt.get(eventName);
      return Number(row.count);
    } else {
      const stmt = db.prepare(`SELECT COUNT(*) as count FROM keyframes`);
      const row: any = stmt.get();
      return Number(row.count);
    }
  }

  /**
   * Deletes a keyframe by its ID.
   */
  public async deleteKeyframe(keyframeId: string): Promise<boolean> {
    const db = this.ensureOpen();
    const stmt = db.prepare(`DELETE FROM keyframes WHERE keyframe_id = ?`);
    const info = stmt.run(keyframeId);
    return info.changes > 0;
  }

  /**
   * Clears all keyframes from storage.
   */
  public async clearKeyframes(): Promise<void> {
    const db = this.ensureOpen();
    db.exec(`DELETE FROM keyframes`);
  }

  /**
   * Inserts a reflective failure report with its diagnostic embedding into storage.
   */
  public async insertFailureRecord(record: FailureVectorRecord): Promise<void> {
    const db = this.ensureOpen();
    const embeddingBuffer = float32ArrayToBuffer(record.embedding);
    const metadataStr = record.metadata ? JSON.stringify(record.metadata) : null;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO reflective_failures (
        failure_id,
        module_id,
        failed_frame_id,
        error_log,
        ast_diff,
        embedding,
        dimension,
        timestamp,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.failureId,
      record.moduleId,
      record.failedFrameId,
      record.errorLog,
      record.astDiff ?? null,
      embeddingBuffer,
      record.embedding.length,
      record.timestamp,
      metadataStr
    );
  }

  /**
   * Searches for similar reflective failure reports using cosine similarity.
   */
  public async searchSimilarFailures(
    queryEmbedding: number[] | Float32Array,
    limit: number = 5,
    minSimilarity: number = -1.0
  ): Promise<FailureSearchResult[]> {
    const db = this.ensureOpen();
    const queryBuffer = float32ArrayToBuffer(queryEmbedding);

    const stmt = db.prepare(`
      SELECT failure_id, module_id, failed_frame_id, error_log, ast_diff, embedding, dimension, timestamp, metadata,
             cosine_similarity(embedding, ?) AS similarity
      FROM reflective_failures
      ORDER BY similarity DESC
      LIMIT ?
    `);

    const rows: any[] = stmt.all(queryBuffer, Math.max(1, limit));

    return rows
      .filter((r) => r.similarity >= minSimilarity)
      .map((r) => ({
        failureId: r.failure_id,
        moduleId: r.module_id,
        failedFrameId: BigInt(r.failed_frame_id),
        errorLog: r.error_log,
        astDiff: r.ast_diff ?? undefined,
        embedding: Array.from(bufferToFloat32Array(r.embedding)),
        timestamp: Number(r.timestamp),
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
        similarity: Number(r.similarity),
      }));
  }

  /**
   * Closes the database connection safely.
   */
  public async close(): Promise<void> {
    if (this.db && this.db.open) {
      this.db.close();
    }
    this.isInitialized = false;
    this.db = undefined;
  }

  private hydrateKeyframeRow(r: any): KeyframeVectorRecord {
    return {
      keyframeId: r.keyframe_id,
      frameId: BigInt(r.frame_id),
      eventName: r.event_name,
      stateJson: r.state_json,
      embedding: Array.from(bufferToFloat32Array(r.embedding)),
      timestamp: Number(r.timestamp),
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    };
  }
}
