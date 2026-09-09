import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnimationSynthesizer } from "../../animation/synthesizer.js";
import {
  GenreTemplate,
  AnimationLayer,
  AnimationIntent,
} from "../../proto/index.js";

export interface AnimationToolsDependencies {
  synthesizer: AnimationSynthesizer;
}

const GENRE_MAP: Record<string, GenreTemplate> = {
  GENRE_GENERIC: GenreTemplate.GENRE_GENERIC,
  GENRE_PLATFORMER: GenreTemplate.GENRE_PLATFORMER,
  GENRE_FPS: GenreTemplate.GENRE_FPS,
  GENRE_ACTION_RPG: GenreTemplate.GENRE_ACTION_RPG,
  GENRE_VEHICLE: GenreTemplate.GENRE_VEHICLE,
};

const LAYER_MAP: Record<string, AnimationLayer> = {
  LAYER_FULL_BODY: AnimationLayer.LAYER_FULL_BODY,
  LAYER_LOWER_BODY: AnimationLayer.LAYER_LOWER_BODY,
  LAYER_UPPER_BODY: AnimationLayer.LAYER_UPPER_BODY,
  LAYER_ADDITIVE: AnimationLayer.LAYER_ADDITIVE,
};

export const SynthesizeAnimationSchema = {
  entityId: z.number().describe("Target character entity ID"),
  intentName: z.string().describe("Animation intent name (e.g. Walk, Run, Jump, Dash, AimDownSights)"),
  genre: z
    .enum(["GENRE_GENERIC", "GENRE_PLATFORMER", "GENRE_FPS", "GENRE_ACTION_RPG", "GENRE_VEHICLE"])
    .optional()
    .default("GENRE_GENERIC")
    .describe("Standardized genre template for intent mapping"),
  layer: z
    .enum(["LAYER_FULL_BODY", "LAYER_LOWER_BODY", "LAYER_UPPER_BODY", "LAYER_ADDITIVE"])
    .optional()
    .default("LAYER_FULL_BODY")
    .describe("Skeletal track layer for action arbitration"),
  priority: z.number().optional().default(10).describe("Action priority (0 to 100)"),
  desiredVelocity: z.number().optional().default(0.0).describe("AI-requested nominal velocity (m/s)"),
  actualVelocity: z.number().optional().default(0.0).describe("Current actual physics velocity (m/s)"),
  intensity: z.number().optional().default(1.0).describe("Movement intensity (0.0 to 1.0)"),
  priorityTags: z.array(z.string()).optional().describe("Tags such as 'uninterruptible' or 'aerial'"),
  blendDuration: z.number().optional().default(0.2).describe("Blend transition duration in seconds"),
  onGround: z.boolean().optional().default(true).describe("Whether entity is currently grounded"),
  frameId: z.string().optional().default("1").describe("Physics frame sequence ID"),
};

/**
 * Registers animation synthesis tools with the MCP server.
 */
export function registerAnimationTools(
  server: McpServer,
  deps: AnimationToolsDependencies
): void {
  server.tool(
    "synthesize_animation",
    "Synthesizes AI intent into blend weights and root motion scaling using genre templates and priority arbitration.",
    SynthesizeAnimationSchema,
    async ({
      entityId,
      intentName,
      genre,
      layer,
      priority,
      desiredVelocity,
      actualVelocity,
      intensity,
      priorityTags,
      blendDuration,
      onGround,
      frameId,
    }) => {
      const genreEnum = GENRE_MAP[genre || "GENRE_GENERIC"] ?? GenreTemplate.GENRE_GENERIC;
      const layerEnum = LAYER_MAP[layer || "LAYER_FULL_BODY"] ?? AnimationLayer.LAYER_FULL_BODY;
      const fId = BigInt(frameId || "1");

      const intent: AnimationIntent = {
        intentName,
        priority: priority ?? 10,
        desiredVelocity: desiredVelocity ?? 0.0,
        intensity: intensity ?? 1.0,
        layer: layerEnum,
        priorityTags: priorityTags || [],
        blendTransitionDuration: blendDuration ?? 0.2,
      };

      const physicsContext = {
        velocity: actualVelocity ?? desiredVelocity ?? 0.0,
        onGround: onGround !== false,
      };

      // Set genre template if configured
      deps.synthesizer.getIntentMapper().setGenre(genreEnum);

      const state = deps.synthesizer.processIntent(
        entityId,
        fId,
        intent,
        physicsContext
      );

      const layerName =
        state.layer !== undefined
          ? Object.entries(AnimationLayer).find(([_, v]) => v === state.layer)?.[0] ?? "LAYER_FULL_BODY"
          : "LAYER_FULL_BODY";

      const result = {
        entityId: state.entityId,
        frameId: state.frameId.toString(),
        activeIntent: state.activeIntent,
        layer: layerName,
        arbitrationPreempted: state.arbitrationPreempted,
        preemptedReason: state.preemptedReason,
        playbackScale: Number(state.playbackScale.toFixed(4)),
        blendWeights: state.blendWeights.map((bw: { clipName: string; weight: number }) => ({
          clipName: bw.clipName,
          weight: Number(bw.weight.toFixed(4)),
        })),
        rootMotion: {
          nominalVelocity: desiredVelocity ?? 0.0,
          actualVelocity: actualVelocity ?? 0.0,
          playbackScale: Number(state.playbackScale.toFixed(4)),
        },
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
