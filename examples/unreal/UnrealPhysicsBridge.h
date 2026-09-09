#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include <memory>
#include <grpcpp/grpcpp.h>
#include "physics_stream.grpc.pb.h"
#include "UnrealPhysicsBridge.generated.h"

/**
 * UUnrealPhysicsBridgeComponent
 * Integrates Unreal Engine 5 actors with mcp-physics-bridge via HTTP/2 gRPC bi-directional streaming.
 */
UCLASS(ClassGroup=(Custom), meta=(BlueprintSpawnableComponent))
class MCPPHYSICS_API UUnrealPhysicsBridgeComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    UUnrealPhysicsBridgeComponent();

    virtual void BeginPlay() override;
    virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MCP Bridge")
    FString ServerAddress = TEXT("localhost:50051");

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "MCP Bridge")
    int32 MaxTrackedEntities = 100;

private:
    std::shared_ptr<grpc::Channel> Channel;
    std::unique_ptr<mcp::physics::PhysicsStreamingService::Stub> Stub;
    grpc::ClientContext Context;
    std::unique_ptr<grpc::ClientReaderWriter<mcp::physics::PhysicsFrameSoA, mcp::physics::PhysicsFrameResponse>> Stream;

    uint64 CurrentFrameId = 0;
    bool bIsConnected = false;

    void SendSoAFrame(float DeltaTime);
};
