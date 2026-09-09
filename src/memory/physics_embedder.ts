import { HierarchicalSceneTree, EntityPhysicsNode } from "../ecs/soa_types.js";
import { PhysicsFrameSoA } from "../proto/index.js";
import { normalizeVector } from "./vector_store.js";

export interface PhysicsEmbeddingOptions {
  dimension?: number;
  includeHarmonics?: boolean;
}

export class PhysicsStateEmbedder {
  private readonly dimension: number;

  constructor(options?: PhysicsEmbeddingOptions) {
    this.dimension = options?.dimension || 128;
  }

  public getDimension(): number {
    return this.dimension;
  }

  /**
   * Generates a normalized semantic embedding vector from a HierarchicalSceneTree.
   */
  public embedSceneTree(
    tree: HierarchicalSceneTree,
    eventName: string = "state",
    customDimension?: number
  ): number[] {
    const dim = customDimension || this.dimension;
    const vec = new Float64Array(dim);

    // Flatten entities
    const nodes: EntityPhysicsNode[] = [];
    const collectNodes = (node: EntityPhysicsNode, depth: number) => {
      nodes.push(node);
      maxDepth = Math.max(maxDepth, depth);
      if (node.children) {
        for (const ch of node.children) {
          collectNodes(ch, depth + 1);
        }
      }
    };

    let maxDepth = 0;
    for (const root of tree.entities) {
      collectNodes(root, 1);
    }

    this.fillPhysicsFeatures(nodes, maxDepth, eventName, vec, dim);
    return normalizeVector(Array.from(vec));
  }

  /**
   * Generates a normalized semantic embedding directly from a flat PhysicsFrameSoA.
   */
  public embedPhysicsFrame(
    frame: PhysicsFrameSoA,
    eventName: string = "state",
    customDimension?: number
  ): number[] {
    const dim = customDimension || this.dimension;
    const vec = new Float64Array(dim);

    const count = frame.entityIds.length;
    const nodes: EntityPhysicsNode[] = [];

    for (let i = 0; i < count; i++) {
      nodes.push({
        id: frame.entityIds[i],
        parentId: frame.parentIds ? frame.parentIds[i] : undefined,
        position: {
          x: frame.posX[i] || 0,
          y: frame.posY[i] || 0,
          z: frame.posZ[i] || 0,
        },
        velocity: {
          x: frame.velX[i] || 0,
          y: frame.velY[i] || 0,
          z: frame.velZ[i] || 0,
        },
        rotation: {
          x: frame.rotX[i] || 0,
          y: frame.rotY[i] || 0,
          z: frame.rotZ[i] || 0,
          w: frame.rotW[i] || 1,
        },
        angularVelocity: frame.angVelX ? {
          x: frame.angVelX[i] || 0,
          y: frame.angVelY ? frame.angVelY[i] || 0 : 0,
          z: frame.angVelZ ? frame.angVelZ[i] || 0 : 0,
        } : undefined,
        radius: frame.radii ? frame.radii[i] : 1.0,
        mass: frame.masses ? frame.masses[i] : 1.0,
      });
    }

    this.fillPhysicsFeatures(nodes, 1, eventName, vec, dim);
    return normalizeVector(Array.from(vec));
  }

  /**
   * Generates a normalized query embedding from a natural language or event string.
   */
  public embedText(text: string, customDimension?: number): number[] {
    const dim = customDimension || this.dimension;
    const vec = new Float64Array(dim);
    const lower = text.toLowerCase();

    // 1. Semantic event keywords
    const eventKeywords: Record<string, number> = {
      collision: 0,
      impact: 0,
      contact: 0,
      hit: 0,
      penetration: 0,
      goal: 1,
      score: 1,
      target: 1,
      win: 1,
      complete: 1,
      state_change: 2,
      transition: 2,
      divergence: 2,
      speed: 3,
      fast: 3,
      velocity: 3,
      momentum: 3,
      failure: 4,
      error: 4,
      reject: 4,
      oob: 4,
      nan: 4,
      clamp: 5,
      dilation: 5,
      rest: 6,
      static: 6,
      stop: 6,
    };

    for (const [kw, band] of Object.entries(eventKeywords)) {
      if (lower.includes(kw)) {
        vec[band * 2] += 2.0;
        vec[band * 2 + 1] += 1.5;
      }
    }

    // 2. Character n-gram hashing for lexical similarity
    for (let i = 0; i < text.length - 2; i++) {
      const h = (text.charCodeAt(i) * 31 + text.charCodeAt(i + 1)) * 31 + text.charCodeAt(i + 2);
      const idx = Math.abs(h) % dim;
      vec[idx] += 1.0;
    }

    // 3. Frequency harmonics
    for (let k = 1; k <= 8; k++) {
      const targetIdx = (dim / 2 + k * 3) % dim;
      vec[targetIdx] += Math.sin((text.length * k * Math.PI) / 10);
    }

    return normalizeVector(Array.from(vec));
  }

  private fillPhysicsFeatures(
    nodes: EntityPhysicsNode[],
    maxDepth: number,
    eventName: string,
    vec: Float64Array,
    dim: number
  ): void {
    const count = nodes.length;

    // --- Band 0: Event Category Signature (indices 0..15) ---
    const lowerEvent = eventName.toLowerCase();
    if (lowerEvent.includes("collision") || lowerEvent.includes("impact")) {
      vec[0] = 3.0; vec[1] = 1.5;
    } else if (lowerEvent.includes("goal") || lowerEvent.includes("target")) {
      vec[2] = 3.0; vec[3] = 1.5;
    } else if (lowerEvent.includes("state") || lowerEvent.includes("change")) {
      vec[4] = 3.0; vec[5] = 1.5;
    } else if (lowerEvent.includes("fail") || lowerEvent.includes("error")) {
      vec[6] = 3.0; vec[7] = 1.5;
    } else {
      vec[8] = 1.5;
    }

    // Event name character hash projection
    let hash = 0;
    for (let i = 0; i < eventName.length; i++) {
      hash = (hash * 31 + eventName.charCodeAt(i)) | 0;
    }
    const eventSlot = 10 + (Math.abs(hash) % 6);
    vec[eventSlot] += 1.0;

    if (count === 0) {
      return;
    }

    // --- Kinematic calculations ---
    let totalMass = 0;
    let comX = 0, comY = 0, comZ = 0;
    let momX = 0, momY = 0, momZ = 0;
    let totalKineticEnergy = 0;
    let maxSpeed = 0;
    let angMomX = 0, angMomY = 0, angMomZ = 0;

    for (const node of nodes) {
      const m = node.mass ?? 1.0;
      totalMass += m;
      comX += node.position.x * m;
      comY += node.position.y * m;
      comZ += node.position.z * m;

      const vx = node.velocity.x;
      const vy = node.velocity.y;
      const vz = node.velocity.z;
      const speedSq = vx * vx + vy * vy + vz * vz;
      const speed = Math.sqrt(speedSq);

      momX += vx * m;
      momY += vy * m;
      momZ += vz * m;
      totalKineticEnergy += 0.5 * m * speedSq;
      maxSpeed = Math.max(maxSpeed, speed);

      if (node.angularVelocity) {
        angMomX += node.angularVelocity.x * m;
        angMomY += node.angularVelocity.y * m;
        angMomZ += node.angularVelocity.z * m;
      }
    }

    if (totalMass > 0) {
      comX /= totalMass;
      comY /= totalMass;
      comZ /= totalMass;
    }

    // Second spatial moments & bounding radius
    let varX = 0, varY = 0, varZ = 0;
    let maxRadiusFromCom = 0;
    for (const node of nodes) {
      const dx = node.position.x - comX;
      const dy = node.position.y - comY;
      const dz = node.position.z - comZ;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + (node.radius ?? 0.5);
      maxRadiusFromCom = Math.max(maxRadiusFromCom, dist);

      const m = node.mass ?? 1.0;
      varX += dx * dx * m;
      varY += dy * dy * m;
      varZ += dz * dz * m;
    }

    if (totalMass > 0) {
      varX /= totalMass;
      varY /= totalMass;
      varZ /= totalMass;
    }

    // --- Band 1: Spatial Distribution & CoM (indices 16..31) ---
    vec[16] = Math.tanh(comX * 0.05);
    vec[17] = Math.tanh(comY * 0.05);
    vec[18] = Math.tanh(comZ * 0.05);
    vec[19] = Math.tanh(maxRadiusFromCom * 0.05);
    vec[20] = Math.tanh(Math.sqrt(varX) * 0.05);
    vec[21] = Math.tanh(Math.sqrt(varY) * 0.05);
    vec[22] = Math.tanh(Math.sqrt(varZ) * 0.05);
    vec[23] = Math.tanh(totalMass * 0.01);

    // Harmonic spatial coordinates
    for (let k = 1; k <= 4; k++) {
      vec[23 + k * 2 - 1] = Math.sin(comX * 0.1 * k);
      vec[23 + k * 2] = Math.cos(comZ * 0.1 * k);
    }

    // --- Band 2: Linear Velocity & Momentum (indices 32..47) ---
    vec[32] = Math.tanh(momX * 0.1);
    vec[33] = Math.tanh(momY * 0.1);
    vec[34] = Math.tanh(momZ * 0.1);
    vec[35] = Math.tanh(maxSpeed * 0.1);
    vec[36] = Math.tanh(totalKineticEnergy * 0.05);

    const momMag = Math.sqrt(momX * momX + momY * momY + momZ * momZ);
    vec[37] = momMag > 1e-5 ? momX / momMag : 0;
    vec[38] = momMag > 1e-5 ? momY / momMag : 0;
    vec[39] = momMag > 1e-5 ? momZ / momMag : 0;

    for (let k = 1; k <= 4; k++) {
      vec[39 + k * 2 - 1] = Math.sin(momX * 0.05 * k);
      vec[39 + k * 2] = Math.cos(momY * 0.05 * k);
    }

    // --- Band 3: Angular Velocity & Orientation (indices 48..63) ---
    vec[48] = Math.tanh(angMomX * 0.1);
    vec[49] = Math.tanh(angMomY * 0.1);
    vec[50] = Math.tanh(angMomZ * 0.1);

    let avgRotX = 0, avgRotY = 0, avgRotZ = 0, avgRotW = 0;
    for (const node of nodes) {
      avgRotX += node.rotation.x;
      avgRotY += node.rotation.y;
      avgRotZ += node.rotation.z;
      avgRotW += node.rotation.w;
    }
    const qNorm = Math.sqrt(avgRotX * avgRotX + avgRotY * avgRotY + avgRotZ * avgRotZ + avgRotW * avgRotW) || 1.0;
    vec[51] = avgRotX / qNorm;
    vec[52] = avgRotY / qNorm;
    vec[53] = avgRotZ / qNorm;
    vec[54] = avgRotW / qNorm;

    // --- Band 4: Entity Topology & Complexity (indices 64..79) ---
    vec[64] = Math.tanh(count * 0.1);
    vec[65] = Math.tanh(maxDepth * 0.2);

    // Entity ID distribution hash
    for (const node of nodes) {
      const slot = 66 + (node.id % 14);
      if (slot < 80) {
        vec[slot] += 0.5;
      }
    }

    // --- Band 5: Proximity & Pairwise Proximity Tensor (indices 80..95) ---
    let minPairwiseDist = Infinity;
    let contactCount = 0;
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const ni = nodes[i];
        const nj = nodes[j];
        const dx = ni.position.x - nj.position.x;
        const dy = ni.position.y - nj.position.y;
        const dz = ni.position.z - nj.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const contactDist = (ni.radius ?? 0.5) + (nj.radius ?? 0.5);
        if (dist <= contactDist) {
          contactCount++;
        }
        minPairwiseDist = Math.min(minPairwiseDist, dist);
      }
    }
    vec[80] = isFinite(minPairwiseDist) ? Math.tanh(minPairwiseDist * 0.1) : 1.0;
    vec[81] = Math.tanh(contactCount * 0.5);

    // --- Band 6: Higher-Order Physical Harmonics (indices 96..dim-1) ---
    const harmonicStart = 96;
    const harmonicLen = dim - harmonicStart;
    for (let i = 0; i < harmonicLen; i++) {
      const freq = (i + 1) * 0.25;
      vec[harmonicStart + i] = Math.sin(comX * freq) * Math.cos(comY * freq) + Math.tanh(totalKineticEnergy * 0.02 * (i + 1));
    }
  }
}
