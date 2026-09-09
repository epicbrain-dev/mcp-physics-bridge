# mcp-physics-bridge: Architectural Design Document

**Description:** Teach AI to play by the rules of physics. An open [Model Context Protocol](https://github.com/modelcontextprotocol) bridge that connects AI agents to any game engine at a smooth 60 FPS—safely, reliably, and without breaking gameplay. Help us build the foundation for living, AI-powered game worlds!

**Topics:** `model-context-protocol` `mcp` `game-engine` `grpc` `webassembly` `wasm` `ai-agents` `ecs` `physics`

## Overview and Security Architecture
The `mcp-physics-bridge` is an engine-agnostic middleware API enforcing game design heuristics to prevent broken mechanics in AI-generated games. The system utilizes a hybrid security model where the AI generates logic compiled into [WebAssembly](https://webassembly.org/). This Wasm runs inside a memory-safe container within the [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol) server, physically isolating it from the host machine. The AI employs Dual-Payload Delivery, sending both human-readable source code for auditing and pre-compiled Wasm bytecode for instant execution. 

## Communication and Web Integration
The MCP server and game engine communicate via [gRPC](https://grpc.io/), using Segregated Services to isolate the high-frequency physics loop from sporadic AI hooks. To maximize transmission speed for the 60 FPS physics loop, the data is packed using a Struct of Arrays (SoA) architecture, which avoids the severe computational overhead of Array of Structs (AoS) in real-time engine processing. To support web-based engines like [Phaser](https://phaser.io/), the server implements Protocol Splitting. Native engines use HTTP/2 gRPC streams for all traffic, while web engines use [gRPC-Web](https://github.com/grpc/grpc-web) for AI hooks and a local [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) for the continuous physics loop. This WebSocket is secured via Token-Handshake Authentication to block Cross-Site WebSocket Hijacking.

## State Authority and Validation Rules
The game engine retains ultimate state authority. Playtest Mode utilizes soft clamping to automatically cap invalid AI physics outputs. Minor logic desynchronizations are smoothed using micro time-dilation, while major divergences trigger a VFX-masked snap based on dynamic collision thresholds. Debug Mode disables these safety nets and appends a physics error status directly to the failing frame, enforcing strict hard rejection and deterministic lockstep to expose raw physics failures directly to the developer. The appended status ensures errors are perfectly synchronized with the exact failing frame for simplified debugging.

## AI Context Management and Flow
A Data Translation Layer converts the engine's flat Entity-Component-System arrays into hierarchical object trees specifically for AI consumption. The bridge limits context bloat by employing Retrieval-Augmented Generation through a local embedded [SQLite-Vector](https://github.com/sqliteai/sqlite-vector) database, indexing the game state only during explicit keyframe events. The AI is invoked exclusively via explicit event hooks manually scripted by the developer. If the AI generates broken code, a semantic diffing and caching pipeline provides reflective memory, sending the AI an abstract syntax tree diff of its past failed logic and compressed error logs.

## Compilation and Math Environment
To eliminate local dependencies and guarantee millisecond compilation times, the AI generates [AssemblyScript](https://www.assemblyscript.org/), which is compiled in-memory on the MCP server. To prevent performance-killing context switching between WebAssembly and JavaScript, the server bundles a native AssemblyScript math library to handle vector and quaternion calculations completely within the sandbox. The bridge utilizes a bring-your-own-key structure to route the MCP standard through any compatible language model.

## AI-to-Rig Animation Synthesizer
To eliminate visual jank, the bridge includes an animation synthesizer that translates raw AI math into engine animations. 
*   **Intent Mapping:** It uses Hybrid Intent-Mapping, where the AI outputs generic intents from an established dictionary. 
*   **Fallback Resolution:** Developers bypass manual setup by importing Standardized Genre Templates, drastically reducing initial setup time and preventing strict rejections. 
*   **Transition Blending:** The synthesizer respects AI timing through Opt-In Weight Streaming, calculating frame-by-frame blend weights that the engine can optionally apply. 
*   **Action Priority:** It resolves priority conflicts using Bridge-Side Arbitration to filter conflicting intents before they reach the engine to minimize overhead. 
*   **Root Motion:** Root motion conflicts are resolved via Physics Authority (Procedural Playback Scaling), mathematically scaling the animation's playback speed to match the AI's requested physics velocity.

## Testing and CI/CD Pipeline
The repository uses [Vitest](https://vitest.dev/) for unit and integration testing. A [GitHub Actions](https://docs.github.com/en/actions) CI/CD pipeline is configured to automatically build the AssemblyScript Wasm modules and execute the Vitest test suite on every pull request or merge to the main branch. This guarantees stability and prevents broken physics logic from reaching production.