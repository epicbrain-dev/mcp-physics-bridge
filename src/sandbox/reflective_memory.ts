import * as as from "assemblyscript";
import { DiagnosticTrace, ReflectiveMemoryReport } from "../proto/index.js";

export interface FailureHistoryEntry {
  moduleId: string;
  sourceCode: string;
  errorLog: string;
  failedFrameId: bigint;
  timestamp: number;
  diagnosticTrace?: DiagnosticTrace;
}

export interface AstDiffResult {
  structuralSummary: string;
  unifiedDiff: string;
  fullDiff: string;
}

/**
 * ReflectiveMemoryPipeline maintains an in-memory cache of past failed logic attempts,
 * providing the AI with AST diffs and compressed error logs for self-correction.
 */
export class ReflectiveMemoryPipeline {
  private failureCache: Map<string, FailureHistoryEntry[]> = new Map();

  /**
   * Records a failed logic execution attempt.
   */
  public recordFailure(
    moduleId: string,
    sourceCode: string,
    errorLog: string,
    failedFrameId: bigint = 0n,
    diagnosticTrace?: DiagnosticTrace
  ): void {
    const history = this.failureCache.get(moduleId) || [];
    history.push({
      moduleId,
      sourceCode,
      errorLog,
      failedFrameId,
      timestamp: Date.now(),
      diagnosticTrace,
    });
    this.failureCache.set(moduleId, history);
  }

  /**
   * Returns failure history for a given module ID.
   */
  public getHistory(moduleId: string): FailureHistoryEntry[] {
    return this.failureCache.get(moduleId) ?? [];
  }

  /**
   * Clears failure history for a specific module or all modules.
   */
  public clearHistory(moduleId?: string): void {
    if (moduleId) {
      this.failureCache.delete(moduleId);
    } else {
      this.failureCache.clear();
    }
  }

  /**
   * Generates a reflective feedback report for the AI containing semantic AST diff and compressed logs.
   */
  public generateReflectiveReport(
    moduleId: string,
    newSourceCode: string
  ): ReflectiveMemoryReport | null {
    const history = this.failureCache.get(moduleId);
    if (!history || history.length === 0) {
      return null;
    }

    const lastFailure = history[history.length - 1];
    const diff = this.generateAstDiff(lastFailure.sourceCode, newSourceCode);
    const compressedErrors = this.compressErrorLogs(lastFailure.errorLog);

    return {
      moduleId,
      astDiff: diff.fullDiff,
      compressedErrorLogs: compressedErrors,
      failedFrameId: lastFailure.failedFrameId,
      diagnosticTrace: lastFailure.diagnosticTrace,
    };
  }

  /**
   * Generates a semantic AST diff comparing previous and new source codes.
   */
  public generateAstDiff(previousSource: string, currentSource: string): AstDiffResult {
    const structuralChanges: string[] = [];

    try {
      const prevParser = new as.Parser();
      prevParser.parseFile(previousSource, "previous.ts", true);

      const currParser = new as.Parser();
      currParser.parseFile(currentSource, "current.ts", true);

      const prevFns = this.extractFunctions(prevParser);
      const currFns = this.extractFunctions(currParser);

      // Check for removed or modified functions
      for (const [name, prevDecl] of prevFns.entries()) {
        if (!currFns.has(name)) {
          structuralChanges.push(`- Function '${name}' removed`);
        } else {
          const currDecl = currFns.get(name)!;
          if (prevDecl.signature !== currDecl.signature) {
            structuralChanges.push(
              `~ Function '${name}' signature changed: (${prevDecl.signature}) => (${currDecl.signature})`
            );
          } else if (prevDecl.bodyText !== currDecl.bodyText) {
            structuralChanges.push(`~ Function '${name}' body modified`);
          }
        }
      }

      // Check for newly added functions
      for (const [name, currDecl] of currFns.entries()) {
        if (!prevFns.has(name)) {
          structuralChanges.push(`+ Function '${name}(${currDecl.signature})' added`);
        }
      }
    } catch {
      structuralChanges.push("~ Note: AST parsing encountered syntax errors; diff fell back to textual comparison");
    }

    const unifiedDiff = this.generateUnifiedDiff(previousSource, currentSource);

    const summarySection =
      structuralChanges.length > 0
        ? `[Semantic AST Summary]\n${structuralChanges.join("\n")}\n\n`
        : `[Semantic AST Summary]\nNo structural function additions/removals detected.\n\n`;

    const fullDiff = `${summarySection}[Unified Source Diff]\n${unifiedDiff}`;

    return {
      structuralSummary: structuralChanges.join("\n"),
      unifiedDiff,
      fullDiff,
    };
  }

  /**
   * Compresses noisy error logs into high-signal diagnostic lines.
   */
  public compressErrorLogs(rawLog: string, maxLines: number = 10): string {
    if (!rawLog || !rawLog.trim()) {
      return "No runtime or compilation errors recorded.";
    }

    const lines = rawLog.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const criticalPatterns = [
      /\bERROR\b/i,
      /\bWARNING\b/i,
      /\bassertion\b/i,
      /\babort\b/i,
      /\bviolation\b/i,
      /\boverflow\b/i,
      /\bNaN\b/i,
      /\bInfinity\b/i,
      /\btimeout\b/i,
      /\bmismatch\b/i,
      /\bclamp\b/i,
      /\bfailure\b/i,
      /\bexceeded\b/i,
      /\bin\s+[\w.-]+\(\d+,\d+\)/i,
    ];

    const filtered: string[] = [];
    let stackTraceLinesSkipped = 0;

    for (const line of lines) {
      if (/^\s*at\s+(?:process|node:|Module|internal\/|async)/.test(line)) {
        stackTraceLinesSkipped++;
        continue;
      }

      const isCritical = criticalPatterns.some((pattern) => pattern.test(line));
      if (isCritical || filtered.length < 3) {
        if (!filtered.includes(line)) {
          filtered.push(line);
        }
      }

      if (filtered.length >= maxLines) {
        break;
      }
    }

    if (filtered.length === 0) {
      filtered.push(...lines.slice(-maxLines));
    }

    let result = filtered.join("\n");
    if (stackTraceLinesSkipped > 0) {
      result += `\n(... ${stackTraceLinesSkipped} internal stack trace lines compressed)`;
    }

    return result;
  }

  /**
   * Formats a reflective report into an AI-ready prompt context string.
   */
  public formatPromptFeedback(report: ReflectiveMemoryReport): string {
    return [
      `### Reflective Memory Feedback for Module '${report.moduleId}'`,
      `Failed on Frame: ${report.failedFrameId.toString()}`,
      `#### Compressed Error Diagnostics:`,
      "```",
      report.compressedErrorLogs,
      "```",
      `#### AST Diff Between Failure and Latest Attempt:`,
      "```diff",
      report.astDiff,
      "```",
    ].join("\n");
  }

  private extractFunctions(
    parser: as.Parser
  ): Map<string, { signature: string; bodyText: string }> {
    const fns = new Map<string, { signature: string; bodyText: string }>();

    for (const source of parser.sources) {
      for (const stmt of source.statements) {
        if (stmt instanceof as.FunctionDeclaration) {
          const fnName = stmt.name.text;
          const fullText = stmt.range.source.text.slice(stmt.range.start, stmt.range.end);
          const sig = stmt.signature ? stmt.range.source.text.slice(stmt.name.range.end, stmt.body ? stmt.body.range.start : stmt.range.end).trim() : "";
          fns.set(fnName, {
            signature: sig,
            bodyText: fullText,
          });
        }
      }
    }

    return fns;
  }

  private generateUnifiedDiff(oldStr: string, newStr: string): string {
    const oldLines = oldStr.split("\n");
    const newLines = newStr.split("\n");

    const diffLines: string[] = [];
    const maxLen = Math.max(oldLines.length, newLines.length);

    diffLines.push(`--- Previous Failing Logic`);
    diffLines.push(`+++ Current Logic`);

    let hunkStart = -1;
    let oldHunk: string[] = [];
    let newHunk: string[] = [];

    const flushHunk = (_lineIdx?: number) => {
      if (oldHunk.length > 0 || newHunk.length > 0) {
        diffLines.push(`@@ -${hunkStart + 1},${oldHunk.length} +${hunkStart + 1},${newHunk.length} @@`);
        for (const l of oldHunk) diffLines.push(`- ${l}`);
        for (const l of newHunk) diffLines.push(`+ ${l}`);
        oldHunk = [];
        newHunk = [];
        hunkStart = -1;
      }
    };

    for (let i = 0; i < maxLen; i++) {
      const oldL = oldLines[i];
      const newL = newLines[i];

      if (oldL !== newL) {
        if (hunkStart === -1) hunkStart = i;
        if (oldL !== undefined) oldHunk.push(oldL);
        if (newL !== undefined) newHunk.push(newL);
      } else {
        flushHunk(i);
      }
    }

    flushHunk(maxLen);

    if (diffLines.length <= 2) {
      return "(No source code modifications detected)";
    }

    return diffLines.join("\n");
  }
}

