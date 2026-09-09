# Security Policy

## Supported Versions

We provide security updates and patches for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

---

## Reporting a Vulnerability

The `mcp-physics-bridge` team takes the security of our software seriously. If you believe you have discovered a security vulnerability in this project, please report it responsibly.

### How to Report
- **Do not open a public GitHub issue** for undisclosed security vulnerabilities.
- Please email details of the vulnerability to: **security@agenticlabs.dev**.
- If possible, encrypt your message or coordinate a secure channel before sharing proof-of-concept exploits.

### What to Include in Your Report
1. A clear description of the vulnerability and its potential impact.
2. Step-by-step reproduction instructions or a minimal proof-of-concept (PoC).
3. The affected component (e.g., WebSocket handshake, gRPC-Web proxy, SQLite vector store, or Wasm sandbox).
4. Any proposed remediations or patches.

### Response Timeline
- **Initial Acknowledgement**: Within 48 hours of receipt.
- **Assessment & Triage**: Within 5 business days.
- **Remediation & Patch**: We aim to release a patch and publish a security advisory within 14 days of triage.

---

## Security Architecture Highlights

- **Timing Side-Channel Protection**: WebSocket authentication employs constant-time SHA-256 digest comparison (`crypto.timingSafeEqual`).
- **CSWSH Defense**: WebSocket and gRPC-Web connections strictly enforce origin checks against configured allowlists.
- **Denial of Service (DoS) Controls**: Maximum WebSocket frame size (5MB), maximum HTTP body size (10MB), and connection concurrency limits.
- **Path Traversal Protection**: Embedded SQLite storage and runtime file paths are normalized using absolute path resolution.
- **Wasm Isolation**: AI-generated logic executes within an isolated, sandboxed WebAssembly memory container without filesystem or host OS bindings.
