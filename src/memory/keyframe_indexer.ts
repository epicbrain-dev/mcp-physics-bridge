import {
  SQLiteVectorStore,
  KeyframeVectorRecord,
  KeyframeSearchResult,
  FailureVectorRecord,
} from "./vector_store.js";
import { PhysicsStateEmbedder } from "./physics_embedder.js";
import { HierarchicalSceneTree, EntityPhysicsNode } from "../ecs/soa_types.js";
import { DataTranslationLayer } from "../ecs/data_translator.js";
import { PhysicsFrameSoA, ReflectiveMemoryReport } from "../proto/index.js";

export type KeyframeEventType =
  | "collision"
  | "goal"
  | "state_change"
  | "failure"
  | "manual"
  | string;

export interface KeyframeIndexerOptions {
  cooldownFrames?: number;
  minStateDelta?: number;
  maxStoredKeyframes?: number;
}

export interface IndexKeyframeOptions {
  customEmbedding?: number[];
  metadata?: Record<string, unknown>;
  bypassCooldown?: boolean;
}

export interface CollisionEventPair {
  entityA: number;
  entityB: number;
  distance: number;
  penetrationDepth: number;
}

interface ThrottleEntry {
  lastFrameId: bigint;
  centerOfMass: [number, number, number];
  totalMomentum: [number, number, number];
}

/**
 * KeyframeIndexer selectively indexes game states into SQLite-Vector storage
 * exclusively during explicit keyframe events to prevent AI context bloat.
 */
export class KeyframeIndexer {
  private readonly embedder: PhysicsStateEmbedder;
  private readonly translator: DataTranslationLayer;
  private readonly cooldownFrames: bigint;
  private readonly minStateDelta: number;
  private readonly throttleMap: Map<string, ThrottleEntry> = new Map();
  private throttledCount: number = 0;

  constructor(
    private readonly vectorStore: SQLiteVectorStore,
    embedder?: PhysicsStateEmbedder,
    options?: KeyframeIndexerOptions
  ) {
    this.embedder = embedder || new PhysicsStateEmbedder({ dimension: vectorStore.defaultDimension });
    this.translator = new DataTranslationLayer();
    this.cooldownFrames = BigInt(options?.cooldownFrames ?? 10);
    this.minStateDelta = options?.minStateDelta ?? 0.5;
  }

  public getEmbedder(): PhysicsStateEmbedder {
    return this.embedder;
  }

  public getThrottledCount(): number {
    return this.throttledCount;
  }

  public resetThrottleState(): void {
    this.throttleMap.clear();
    this.throttledCount = 0;
  }

  /**
   * Selectively indexes a keyframe snapshot from a HierarchicalSceneTree.
   * Throttles duplicate/high-frequency events within cooldownFrames to prevent context bloat.
   */
  public async indexKeyframeEvent(
    eventName: KeyframeEventType,
    tree: HierarchicalSceneTree,
    options?: IndexKeyframeOptions
  ): Promise<KeyframeVectorRecord | null> {
    const frameId = tree.frameId;

    // Check cooldown / throttling
    if (!options?.bypassCooldown && this.shouldThrottle(eventName, tree)) {
      this.throttledCount++;
      return null;
    }

    const stateJson = this.translator.toCompactJson(tree, {
      precision: 3,
      includeVelocities: true,
      includeRotations: true,
      indent: 0,
    });

    const embedding =
      options?.customEmbedding || this.embedder.embedSceneTree(tree, eventName);

    const record: KeyframeVectorRecord = {
      keyframeId: `${eventName}_${frameId.toString()}_${Date.now()}`,
      frameId,
      eventName,
      stateJson,
      embedding,
      timestamp: Date.now(),
      metadata: options?.metadata,
    };

    await this.vectorStore.insertKeyframe(record);
    this.recordThrottleState(eventName, tree);

    return record;
  }

  /**
   * Selectively indexes a flat PhysicsFrameSoA by translating it to a scene tree first.
   */
  public async indexPhysicsFrame(
    eventName: KeyframeEventType,
    frame: PhysicsFrameSoA,
    options?: IndexKeyframeOptions
  ): Promise<KeyframeVectorRecord | null> {
    const tree = this.translator.soaToHierarchy(frame);
    return this.indexKeyframeEvent(eventName, tree, options);
  }

  /**
   * Stores a reflective failure report and its diagnostic vector into the vector store.
   */
  public async indexFailure(
    report: ReflectiveMemoryReport,
    errorLog: string
  ): Promise<FailureVectorRecord> {
    const diagnosticText = `${report.moduleId} ${errorLog} ${report.astDiff || ""}`;
    const embedding = this.embedder.embedText(diagnosticText);

    const record: FailureVectorRecord = {
      failureId: `fail_${report.moduleId}_${report.failedFrameId.toString()}_${Date.now()}`,
      moduleId: report.moduleId,
      failedFrameId: report.failedFrameId,
      errorLog,
      astDiff: report.astDiff,
      embedding,
      timestamp: Date.now(),
      metadata: {
        consoleLogs: report.diagnosticTrace?.consoleLogs,
        errorCategory: report.diagnosticTrace?.errorCategory,
      },
    };

    await this.vectorStore.insertFailureRecord(record);
    return record;
  }

  /**
   * Detects collision contacts between entities in a PhysicsFrameSoA using bounding spheres.
   */
  public detectCollisionEvents(frame: PhysicsFrameSoA): CollisionEventPair[] {
    const collisions: CollisionEventPair[] = [];
    const count = frame.entityIds.length;
    if (count < 2) return collisions;

    const radii = frame.radii;
    const posX = frame.posX;
    const posY = frame.posY;
    const posZ = frame.posZ;

    for (let i = 0; i < count; i++) {
      const rA = radii ? radii[i] : 0.5;
      const xA = posX[i];
      const yA = posY[i];
      const zA = posZ[i];

      for (let j = i + 1; j < count; j++) {
        const rB = radii ? radii[j] : 0.5;
        const dx = xA - posX[j];
        const dy = yA - posY[j];
        const dz = zA - posZ[j];
        const distSq = dx * dx + dy * dy + dz * dz;
        const minDist = rA + rB;

        if (distSq <= minDist * minDist) {
          const dist = Math.sqrt(distSq);
          collisions.push({
            entityA: frame.entityIds[i],
            entityB: frame.entityIds[j],
            distance: dist,
            penetrationDepth: minDist - dist,
          });
        }
      }
    }

    return collisions;
  }

  /**
   * Detects significant velocity deltas or phase changes between two scene trees.
   */
  public detectStateChange(
    currentTree: HierarchicalSceneTree,
    previousTree: HierarchicalSceneTree,
    velocityThreshold: number = 2.0
  ): boolean {
    const prevMap = new Map<number, EntityPhysicsNode>();

    const flatten = (nodes: EntityPhysicsNode[], map: Map<number, EntityPhysicsNode>) => {
      for (const node of nodes) {
        map.set(node.id, node);
        if (node.children) flatten(node.children, map);
      }
    };

    flatten(previousTree.entities, prevMap);

    let maxDelta = 0;
    const checkNodes = (nodes: EntityPhysicsNode[]) => {
      for (const curr of nodes) {
        const prev = prevMap.get(curr.id);
        if (prev) {
          const dvx = curr.velocity.x - prev.velocity.x;
          const dvy = curr.velocity.y - prev.velocity.y;
          const dvz = curr.velocity.z - prev.velocity.z;
          const delta = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
          maxDelta = Math.max(maxDelta, delta);
        }
        if (curr.children) checkNodes(curr.children);
      }
    };

    checkNodes(currentTree.entities);
    return maxDelta >= velocityThreshold;
  }

  /**
   * Retrieves historical keyframe records similar to the given physics scene state.
   */
  public async queryContextForEvent(
    eventName: KeyframeEventType,
    currentTree: HierarchicalSceneTree,
    limit: number = 5,
    minSimilarity: number = 0.0
  ): Promise<KeyframeSearchResult[]> {
    const embedding = this.embedder.embedSceneTree(currentTree, eventName);
    return this.vectorStore.searchSimilarKeyframes(embedding, limit, minSimilarity, eventName);
  }

  /**
   * Retrieves historical keyframe records similar to a natural language query.
   */
  public async queryContextByText(
    queryText: string,
    limit: number = 5,
    minSimilarity: number = 0.0,
    eventNameFilter?: string
  ): Promise<KeyframeSearchResult[]> {
    const embedding = this.embedder.embedText(queryText);
    return this.vectorStore.searchSimilarKeyframes(
      embedding,
      limit,
      minSimilarity,
      eventNameFilter
    );
  }

  /**
   * Formats retrieved keyframes into a token-efficient RAG context string for AI prompts.
   */
  public formatRAGPromptContext(
    results: KeyframeSearchResult[],
    options?: { maxResults?: number }
  ): string {
    if (!results || results.length === 0) {
      return "No historical keyframe context found.";
    }

    const max = options?.maxResults || results.length;
    const items = results.slice(0, max);

    const sections: string[] = [
      "### Relevant Keyframe History (RAG Context)",
      "The following historical keyframe events were retrieved based on physical state similarity:",
    ];

    for (const item of items) {
      const simPercent = (item.similarity * 100).toFixed(1);
      sections.push(
        `- **Keyframe \`${item.keyframeId}\`** (Event: \`${item.eventName}\`, Frame: ${item.frameId.toString()}, Sim: ${simPercent}%):`,
        "```json",
        item.stateJson,
        "```"
      );
    }

    return sections.join("\n");
  }

  private shouldThrottle(eventName: string, tree: HierarchicalSceneTree): boolean {
    const entry = this.throttleMap.get(eventName);
    if (!entry) {
      return false;
    }

    // If cooldown has elapsed, allow indexing
    const frameDelta = tree.frameId - entry.lastFrameId;
    if (frameDelta >= this.cooldownFrames) {
      return false;
    }

    // Check kinematic delta
    const currentSummary = this.computeStateSummary(tree);
    const posDiff = Math.sqrt(
      Math.pow(currentSummary.com[0] - entry.centerOfMass[0], 2) +
      Math.pow(currentSummary.com[1] - entry.centerOfMass[1], 2) +
      Math.pow(currentSummary.com[2] - entry.centerOfMass[2], 2)
    );

    const momDiff = Math.sqrt(
      Math.pow(currentSummary.mom[0] - entry.totalMomentum[0], 2) +
      Math.pow(currentSummary.mom[1] - entry.totalMomentum[1], 2) +
      Math.pow(currentSummary.mom[2] - entry.totalMomentum[2], 2)
    );

    // If state has significantly changed despite being within cooldown, do not throttle
    if (posDiff > this.minStateDelta || momDiff > this.minStateDelta * 2) {
      return false;
    }

    return true;
  }

  private recordThrottleState(eventName: string, tree: HierarchicalSceneTree): void {
    const summary = this.computeStateSummary(tree);
    this.throttleMap.set(eventName, {
      lastFrameId: tree.frameId,
      centerOfMass: summary.com,
      totalMomentum: summary.mom,
    });
  }

  private computeStateSummary(tree: HierarchicalSceneTree): {
    com: [number, number, number];
    mom: [number, number, number];
  } {
    let mass = 0;
    let cx = 0, cy = 0, cz = 0;
    let mx = 0, my = 0, mz = 0;

    const visit = (node: EntityPhysicsNode) => {
      const m = node.mass ?? 1.0;
      mass += m;
      cx += node.position.x * m;
      cy += node.position.y * m;
      cz += node.position.z * m;
      mx += node.velocity.x * m;
      my += node.velocity.y * m;
      mz += node.velocity.z * m;

      if (node.children) {
        for (const ch of node.children) visit(ch);
      }
    };

    for (const root of tree.entities) {
      visit(root);
    }

    if (mass > 0) {
      cx /= mass;
      cy /= mass;
      cz /= mass;
    }

    return {
      com: [cx, cy, cz],
      mom: [mx, my, mz],
    };
  }
}
