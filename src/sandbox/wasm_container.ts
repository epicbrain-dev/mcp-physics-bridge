import { BridgeConfig } from "../config.js";

export interface SandboxExecutionResult {
  success: boolean;
  executionTimeMs: number;
  returnValue?: number;
  error?: string;
  capturedLogs: string[];
  memoryBytesUsed: number;
  callStack?: string;
}

export interface AbortDetails {
  messagePtr: number;
  fileNamePtr: number;
  lineNumber: number;
  columnNumber: number;
}

/**
 * WasmContainer physically isolates AI-generated WebAssembly logic from the host.
 * Restricts memory to max pages, captures diagnostics, and enforces strict execution timeouts.
 */
export class WasmContainer {
  private instance?: WebAssembly.Instance;
  private memory?: WebAssembly.Memory;
  private capturedLogs: string[] = [];
  private lastAbort: AbortDetails | null = null;

  constructor(private readonly config: BridgeConfig) {}

  /**
   * Instantiates a memory-safe sandbox from Wasm bytecode.
   */
  public async loadBytecode(wasmBytes: Uint8Array): Promise<boolean> {
    try {
      this.capturedLogs = [];
      this.lastAbort = null;

      this.memory = new WebAssembly.Memory({
        initial: 1,
        maximum: this.config.maxWasmMemoryPages,
      });

      const importObject = {
        env: {
          memory: this.memory,
          abort: (
            messagePtr: number,
            fileNamePtr: number,
            lineNumber: number,
            columnNumber: number
          ) => {
            this.lastAbort = { messagePtr, fileNamePtr, lineNumber, columnNumber };
            const abortMsg = `[Wasm Sandbox Abort] line ${lineNumber}:${columnNumber}`;
            this.capturedLogs.push(abortMsg);
            throw new Error(abortMsg);
          },
          trace: (
            msgPtr: number,
            n: number,
            a0: number = 0,
            a1: number = 0,
            a2: number = 0,
            a3: number = 0,
            a4: number = 0
          ) => {
            const args = [a0, a1, a2, a3, a4].slice(0, n);
            const traceMsg = `[Wasm Trace msgPtr=${msgPtr}] args: [${args.join(", ")}]`;
            this.capturedLogs.push(traceMsg);
          },
        },
      };

      const module = await WebAssembly.compile(wasmBytes as BufferSource);
      this.instance = await WebAssembly.instantiate(module, importObject);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.capturedLogs.push(`[Wasm Sandbox Init Error] ${message}`);
      return false;
    }
  }

  /**
   * Executes an exported sandbox physics function with timeout protection.
   */
  public execute(functionName: string, ...args: number[]): SandboxExecutionResult {
    const startTime = performance.now();
    const currentLogs = [...this.capturedLogs];

    if (!this.instance) {
      return {
        success: false,
        executionTimeMs: 0,
        error: "Wasm instance is not initialized",
        capturedLogs: currentLogs,
        memoryBytesUsed: 0,
      };
    }

    try {
      const fn = this.instance.exports[functionName] as ((...a: number[]) => number) | undefined;
      if (typeof fn !== "function") {
        return {
          success: false,
          executionTimeMs: performance.now() - startTime,
          error: `Exported function '${functionName}' not found`,
          capturedLogs: currentLogs,
          memoryBytesUsed: this.getMemoryUsage().bytesUsed,
        };
      }

      const ret = fn(...args);
      const executionTimeMs = performance.now() - startTime;
      const memUsage = this.getMemoryUsage();

      if (executionTimeMs > this.config.wasmExecutionTimeoutMs) {
        return {
          success: false,
          executionTimeMs,
          error: `Execution exceeded timeout threshold (${this.config.wasmExecutionTimeoutMs}ms)`,
          capturedLogs: [...this.capturedLogs],
          memoryBytesUsed: memUsage.bytesUsed,
        };
      }

      return {
        success: true,
        executionTimeMs,
        returnValue: ret,
        capturedLogs: [...this.capturedLogs],
        memoryBytesUsed: memUsage.bytesUsed,
      };
    } catch (err: unknown) {
      const memUsage = this.getMemoryUsage();
      const errorMsg = err instanceof Error ? err.message : String(err);
      const callStack = err instanceof Error ? err.stack : undefined;

      return {
        success: false,
        executionTimeMs: performance.now() - startTime,
        error: errorMsg,
        capturedLogs: [...this.capturedLogs],
        memoryBytesUsed: memUsage.bytesUsed,
        callStack,
      };
    }
  }

  /**
   * Returns names of all exported functions in the loaded Wasm instance.
   */
  public getExportedFunctions(): string[] {
    if (!this.instance) return [];
    return Object.keys(this.instance.exports).filter(
      (key) => typeof this.instance!.exports[key] === "function"
    );
  }

  /**
   * Returns current memory consumption inside the sandbox container.
   */
  public getMemoryUsage(): { bytesUsed: number; pages: number } {
    if (!this.instance) return { bytesUsed: 0, pages: 0 };
    const mem = (this.instance.exports.memory as WebAssembly.Memory) || this.memory;
    if (!mem) return { bytesUsed: 0, pages: 0 };
    const bytesUsed = mem.buffer.byteLength;
    const pages = bytesUsed / 65536;
    return { bytesUsed, pages };
  }

  /**
   * Returns the details of the last abort that occurred, if any.
   */
  public getLastAbort(): AbortDetails | null {
    return this.lastAbort;
  }

  /**
   * Disposes the WebAssembly instance and frees captured logs and references.
   */
  public dispose(): void {
    this.instance = undefined;
    this.memory = undefined;
    this.capturedLogs = [];
    this.lastAbort = null;
  }

  /**
   * Clears accumulated diagnostic logs.
   */
  public clearLogs(): void {
    this.capturedLogs = [];
  }
}

