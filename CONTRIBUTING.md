# Contributing to mcp-physics-bridge

Thank you for your interest in contributing to `mcp-physics-bridge`! We welcome contributions from game engine developers, AI engineers, and systems programmers.

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free experience for everyone. Please be respectful, constructive, and collaborative in all discussions and pull requests.

---

## Development Environment Setup

### Prerequisites
- **Node.js**: `v20.x` or higher
- **npm**: `v10.x` or higher
- **Git**: Modern git client

### Clone & Install
```bash
git clone https://github.com/epicbrain-dev/mcp-physics-bridge.git
cd mcp-physics-bridge
npm install
```

### Build Pipelines
1. **Compile AssemblyScript WebAssembly Modules:**
   ```bash
   npm run build:as
   ```
2. **Compile TypeScript Codebase:**
   ```bash
   npm run build
   ```
3. **Generate Protobuf TypeScript Types (if schemas change):**
   ```bash
   npm run proto:generate
   ```

---

## Running Tests & Verifications

We maintain a strict >90% test coverage and zero-regression policy.

```bash
# Run all unit and integration tests (27 test suites)
npm test

# Run tests with V8 coverage report
npm run test:coverage

# Perform TypeScript static typecheck
npm run typecheck

# Execute end-to-end 10-phase manual verification
npm run verify
```

---

## Architectural Principles

When writing or modifying code in this repository, please adhere to these core principles:

1. **Deterministic Physics Boundary**: WebAssembly physics kernels must remain 100% deterministic across all platforms. Avoid non-deterministic floating point functions or platform-dependent random generators inside physics step loops.
2. **Zero-Copy Struct of Arrays (SoA)**: 60 FPS state streaming must use flat contiguous `Float32Array` / `Uint32Array` buffers. Avoid allocating intermediate objects or arrays inside the per-frame hot path.
3. **Protocol Splitting**:
   - High-frequency 60 FPS physics loops use gRPC bi-directional streaming (native engines) or WebSocket with binary frames (web engines).
   - Low-frequency AI reasoning and tool calls use the Model Context Protocol (MCP) and gRPC-Web gateway.
4. **Security by Default**:
   - Never commit hardcoded tokens, passwords, or API keys.
   - Use timing-safe comparisons (`crypto.timingSafeEqual`) for all authentication tokens.
   - Guard against Cross-Site WebSocket Hijacking (CSWSH) and validate CORS origins.
5. **Zero-Friction BYOK & Onboarding**:
   - Ensure the server runs immediately out of the box without requiring paid external LLM credentials (fallback to deterministic mock provider).

---

## Submitting Pull Requests

1. **Fork and Branch**: Create a descriptive feature branch from `main` (e.g., `feat/unreal-soa-adapter` or `fix/ws-origin-validation`).
2. **Write Tests**: Add unit or integration tests in `tests/unit/` or `tests/integration/` covering your changes.
3. **Verify Locally**: Ensure `npm run typecheck`, `npm test`, and `npm run verify` all pass with 0 errors.
4. **Clean Commits**: Use clear, conventional commit messages (`feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`).
5. **Open PR**: Open a pull request against `main` using the provided Pull Request template.

Thank you for helping push the boundary of AI-driven game physics!
