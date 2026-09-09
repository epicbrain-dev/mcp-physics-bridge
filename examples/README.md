# Client Engine Integration Examples

`mcp-physics-bridge` is designed to be engine-agnostic. It bridges AI reasoning and deterministic physics simulation with any game engine via standard protocols.

---

## Supported Protocols & Engine Matrix

| Game Engine | Primary Protocol | Data Format | Target Tick Rate | Example Path |
|---|---|---|---|---|
| **Unity** | Native HTTP/2 gRPC | Protobuf Stream | 60 FPS | [`unity/PhysicsBridgeClient.cs`](./unity/PhysicsBridgeClient.cs) |
| **Unreal Engine 5** | Native HTTP/2 gRPC | Protobuf Stream | 60 FPS | [`unreal/UnrealPhysicsBridge.cpp`](./unreal/UnrealPhysicsBridge.cpp) |
| **Godot 4** | WebSocket (Token Auth) | JSON / FlatBuffers | 60 FPS | [`godot/PhysicsBridgeClient.gd`](./godot/PhysicsBridgeClient.gd) |
| **Web (Phaser / Three.js)** | WebSocket + gRPC-Web | Binary Frame + JSON | 60 FPS | [`web/index.html`](./web/index.html) |

---

## Compiling Protobuf Definitions for Your Engine

The canonical `.proto` contracts reside in the [`proto/`](../proto/) directory:
- `physics_stream.proto`: Struct of Arrays 60 FPS streaming schema and error bitmasks.
- `ai_hooks.proto`: Sporadic AI hooks, Dual-Payload bytecode, and diagnostic traces.
- `animation_stream.proto`: Animation intents, blend weights, and playback scale.

### 1. Unity (C#)
Generate C# gRPC stubs using the `Grpc.Tools` package in Unity or via command line:
```bash
protoc -I=../proto \
  --csharp_out=unity/Generated \
  --grpc_out=unity/Generated \
  --plugin=protoc-gen-grpc=`which grpc_csharp_plugin` \
  ../proto/*.proto
```

### 2. Unreal Engine 5 (C++)
Generate C++ Protobuf stubs:
```bash
protoc -I=../proto \
  --cpp_out=unreal/Generated \
  --grpc_out=unreal/Generated \
  --plugin=protoc-gen-grpc=`which grpc_cpp_plugin` \
  ../proto/*.proto
```

### 3. Python (Gym / RL environments)
Generate Python stubs:
```bash
python -m grpc_tools.protoc -I=../proto \
  --python_out=. \
  --grpc_python_out=. \
  ../proto/*.proto
```

---

## Quickstart Tour

- **[Unity C# Client Guide](./unity/PhysicsBridgeClient.cs)**: Demonstrates connecting to `localhost:50051`, packing GameObjects into flat `PhysicsFrameSoA` buffers, and synchronizing at 60 FPS.
- **[Unreal Engine 5 Guide](./unreal/UnrealPhysicsBridge.cpp)**: Demonstrates an Actor Component communicating with the gRPC bi-directional stream.
- **[Godot 4 Client Guide](./godot/PhysicsBridgeClient.gd)**: Demonstrates Godot WebSocket client connecting to `ws://localhost:8080` with the runtime authentication token.
- **[Web Visualizer Demo](./web/index.html)**: Standalone HTML5 Canvas visualizer you can open directly in any browser to verify WebSocket streaming.
