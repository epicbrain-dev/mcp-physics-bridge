using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using Grpc.Core;
using Grpc.Net.Client;
using Mcp.Physics;

namespace McpPhysicsBridge.Unity
{
    /// <summary>
    /// Connects Unity to mcp-physics-bridge over native HTTP/2 gRPC bi-directional streaming.
    /// Synchronizes transforms at 60 FPS in FixedUpdate using Struct of Arrays (SoA).
    /// </summary>
    public class PhysicsBridgeClient : MonoBehaviour
    {
        [Header("Bridge Server Configuration")]
        [SerializeField] private string serverAddress = "http://localhost:50051";
        [SerializeField] private uint entityCount = 100;
        [SerializeField] private bool debugValidation = false;

        private GrpcChannel channel;
        private PhysicsStreamingService.PhysicsStreamingServiceClient client;
        private AsyncDuplexStreamingCall<PhysicsFrameSoA, PhysicsFrameResponse> stream;
        private CancellationTokenSource cts;

        private ulong currentFrameId = 0;

        private void Start()
        {
            InitializeGrpcClient();
            StartStreaming();
        }

        private void InitializeGrpcClient()
        {
            // Configure HTTP/2 unencrypted support for local development
            AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true);

            channel = GrpcChannel.ForAddress(serverAddress, new GrpcChannelOptions
            {
                MaxReceiveMessageSize = 16 * 1024 * 1024,
                MaxSendMessageSize = 16 * 1024 * 1024
            });

            client = new PhysicsStreamingService.PhysicsStreamingServiceClient(channel);
            cts = new CancellationTokenSource();
            Debug.Log($"[MCP Bridge] Connected gRPC client to {serverAddress}");
        }

        private async void StartStreaming()
        {
            try
            {
                stream = client.StreamPhysics(cancellationToken: cts.Token);

                // Background task to read bridge validation responses
                _ = Task.Run(async () =>
                {
                    while (await stream.ResponseStream.MoveNext(cts.Token))
                    {
                        var response = stream.ResponseStream.Current;
                        OnPhysicsFrameResponse(response);
                    }
                }, cts.Token);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[MCP Bridge] Streaming connection failed: {ex.Message}");
            }
        }

        private void FixedUpdate()
        {
            if (stream == null) return;

            currentFrameId++;

            // Construct flat Struct of Arrays (SoA) frame
            var frame = new PhysicsFrameSoA
            {
                FrameId = currentFrameId,
                TimestampNs = (ulong)(DateTime.UtcNow.Ticks * 100),
                EntityCount = entityCount,
                DeltaTime = Time.fixedDeltaTime,
                IsKeyframe = (currentFrameId % 60 == 0),
                TargetFps = 60
            };

            // Populate contiguous float arrays for active rigid bodies
            for (int i = 0; i < entityCount; i++)
            {
                frame.EntityIds.Add((uint)(i + 1));
                frame.Positions.AddRange(new float[] { i * 1.5f, 0.5f, 0.0f });
                frame.Rotations.AddRange(new float[] { 0.0f, 0.0f, 0.0f, 1.0f });
                frame.LinearVelocities.AddRange(new float[] { 0.0f, -9.81f * Time.fixedDeltaTime, 0.0f });
                frame.AngularVelocities.AddRange(new float[] { 0.0f, 0.0f, 0.0f });
                frame.Masses.Add(1.0f);
            }

            // Stream frame to bridge
            stream.RequestStream.WriteAsync(frame);
        }

        private void OnPhysicsFrameResponse(PhysicsFrameResponse response)
        {
            if (response.ValidationStatus != AuthorityStatus.StatusDeterministicOk)
            {
                Debug.LogWarning($"[MCP Bridge] Frame {response.FrameId} soft-clamped or corrected: {response.ValidationStatus}");
            }
        }

        private async void OnDestroy()
        {
            cts?.Cancel();
            if (stream != null)
            {
                await stream.RequestStream.CompleteAsync();
            }
            channel?.Dispose();
            Debug.Log("[MCP Bridge] Stream closed gracefully.");
        }
    }
}
