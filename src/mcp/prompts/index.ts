import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GAME_PHYSICS_SYSTEM_PROMPT } from "./game_heuristics.js";
import { MATH_API_REFERENCE } from "../llm/byok_router.js";

export { GAME_PHYSICS_SYSTEM_PROMPT };

export const GameHeuristicsPromptArgs = {
  taskDescription: z.string().describe("Description of the gameplay mechanic or physics logic to implement"),
  targetEntity: z.string().optional().describe("Optional entity name or role (e.g. Player, Vehicle, Projectile)"),
  contextJson: z.string().optional().describe("Optional JSON snapshot of current entity scene state"),
};

export const DebugPhysicsPromptArgs = {
  moduleId: z.string().describe("Module identifier that failed validation or threw an error"),
  errorLog: z.string().describe("Error messages, bitmask diagnostics, or stack traces"),
  originalSource: z.string().optional().describe("Original AssemblyScript source code"),
  astDiff: z.string().optional().describe("AST structural diff between iterations"),
};

export const SynthesizeAnimationPromptArgs = {
  characterAction: z.string().describe("Description of character movement or action"),
  genre: z.string().optional().describe("Genre template (e.g. Platformer, FPS, Action RPG)"),
  currentSpeed: z.string().optional().describe("Current speed or velocity magnitude (m/s)"),
};

/**
 * Registers standardized MCP prompts with the MCP server.
 */
export function registerPrompts(server: McpServer): void {
  // 1. game_heuristics_kernel
  server.prompt(
    "game_heuristics_kernel",
    "Generates prompt instructions for writing deterministic AssemblyScript physics kernels.",
    GameHeuristicsPromptArgs,
    ({ taskDescription, targetEntity, contextJson }) => {
      const instructions = `Task: Implement game physics logic for "${taskDescription}"
Target Entity: ${targetEntity || "Primary Character"}
${contextJson ? `Scene State:\n\`\`\`json\n${contextJson}\n\`\`\`` : ""}

Instructions:
1. Write deterministic AssemblyScript code.
2. Import { Vector3 } from "./math/vector3" and { Quaternion } from "./math/quaternion".
3. Export an entrypoint function: \`export function stepPhysics(dt: f32): f32\`
4. Bound all velocities and prevent NaNs or Infinities.
5. Return the AssemblyScript source enclosed in a \`\`\`typescript ... \`\`\` block.`;

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `${GAME_PHYSICS_SYSTEM_PROMPT}\n\n${MATH_API_REFERENCE}\n\n${instructions}`,
            },
          },
        ],
      };
    }
  );

  // 2. debug_physics_failure
  server.prompt(
    "debug_physics_failure",
    "Prepares a reflective debugging prompt to repair failing AssemblyScript physics logic.",
    DebugPhysicsPromptArgs,
    ({ moduleId, errorLog, originalSource, astDiff }) => {
      const content = `Debug and fix failing physics module: \`${moduleId}\`

Error Diagnostics:
${errorLog}

${originalSource ? `Original Source:\n\`\`\`typescript\n${originalSource}\n\`\`\`` : ""}
${astDiff ? `AST Structural Diff:\n\`\`\`\n${astDiff}\n\`\`\`` : ""}

Instructions:
1. Identify the root cause of the error (e.g., division by zero, unnormalized rotation, unbounded velocity).
2. Provide the complete fixed AssemblyScript code in a \`\`\`typescript ... \`\`\` block.
3. Ensure the module compiles cleanly with the bundled AssemblyScript math library.`;

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `${GAME_PHYSICS_SYSTEM_PROMPT}\n\n${content}`,
            },
          },
        ],
      };
    }
  );

  // 3. synthesize_character_animation
  server.prompt(
    "synthesize_character_animation",
    "Guides the AI in mapping physics state and character actions into animation intents.",
    SynthesizeAnimationPromptArgs,
    ({ characterAction, genre, currentSpeed }) => {
      const text = `Character Action: ${characterAction}
Genre: ${genre || "GENRE_GENERIC"}
Current Speed: ${currentSpeed || "0.0"} m/s

Please resolve this action into a structured AnimationIntent JSON:
- intentName: Standardized intent name
- priority: Action priority (0-100)
- desiredVelocity: Nominal target root motion speed in m/s
- intensity: 0.0 to 1.0
- layer: Full Body (0), Lower Body (1), Upper Body (2), Additive (3)
- priorityTags: Optional tags (e.g. ["uninterruptible", "aerial"])
- blendTransitionDuration: Transition blend time in seconds (e.g. 0.2)`;

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text,
            },
          },
        ],
      };
    }
  );
}
