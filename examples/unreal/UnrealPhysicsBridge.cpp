#include "UnrealPhysicsBridge.h"

UUnrealPhysicsBridgeComponent::UUnrealPhysicsBridgeComponent()
{
    PrimaryComponentTick.bCanEverTick = true;
    PrimaryComponentTick.TickGroup = TG_PrePhysics;
}

void UUnrealPhysicsBridgeComponent::BeginPlay()
{
    Super::BeginPlay();

    std::string TargetAddress = TCHAR_TO_UTF8(*ServerAddress);
    Channel = grpc::CreateChannel(TargetAddress, grpc::InsecureChannelCredentials());
    Stub = mcp::physics::PhysicsStreamingService::NewStub(Channel);

    Stream = Stub->StreamPhysics(&Context);
    bIsConnected = (Stream != nullptr);

    if (bIsConnected)
    {
        UE_LOG(LogTemp, Log, TEXT("[MCP Bridge] Connected to %s"), *ServerAddress);
    }
}

void UUnrealPhysicsBridgeComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
    Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

    if (!bIsConnected || !Stream) return;

    SendSoAFrame(DeltaTime);
}

void UUnrealPhysicsBridgeComponent::SendSoAFrame(float DeltaTime)
{
    CurrentFrameId++;

    mcp::physics::PhysicsFrameSoA Frame;
    Frame.set_frame_id(CurrentFrameId);
    Frame.set_timestamp_ns(FPlatformTime::Cycles64());
    Frame.set_entity_count(MaxTrackedEntities);
    Frame.set_delta_time(DeltaTime);
    Frame.set_is_keyframe(CurrentFrameId % 60 == 0);
    Frame.set_target_fps(60);

    // Flatten Actor transform data into contiguous buffers
    for (int32 i = 0; i < MaxTrackedEntities; ++i)
    {
        Frame.add_entity_ids(i + 1);

        // Position (X, Y, Z)
        Frame.add_positions(i * 100.0f);
        Frame.add_positions(0.0f);
        Frame.add_positions(50.0f);

        // Rotation (Quaternion: X, Y, Z, W)
        Frame.add_rotations(0.0f);
        Frame.add_rotations(0.0f);
        Frame.add_rotations(0.0f);
        Frame.add_rotations(1.0f);

        // Linear Velocity
        Frame.add_linear_velocities(0.0f);
        Frame.add_linear_velocities(0.0f);
        Frame.add_linear_velocities(-980.0f * DeltaTime);

        // Angular Velocity
        Frame.add_angular_velocities(0.0f);
        Frame.add_angular_velocities(0.0f);
        Frame.add_angular_velocities(0.0f);

        Frame.add_masses(1.0f);
    }

    Stream->Write(Frame);
}

void UUnrealPhysicsBridgeComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    if (Stream)
    {
        Stream->WritesDone();
        Context.TryCancel();
    }
    Super::EndPlay(EndPlayReason);
}
