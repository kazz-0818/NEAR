import { Canvas } from "@react-three/fiber";
import { CosmicSpaceScene } from "./space/CosmicSpaceScene";
import { hashSeed } from "./space/cosmicUtils";

interface AgentSpace3DProps {
  accent: string;
  agentId: string;
}

export function AgentSpace3D({ accent, agentId }: AgentSpace3DProps) {
  return (
    <Canvas
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
      dpr={[1, 1.5]}
      gl={{
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      }}
      camera={{ position: [0, 0.2, 6.2], fov: 56 }}
      style={{ opacity: 1 }}
    >
      <CosmicSpaceScene accent={accent} seed={hashSeed(agentId)} variant="agent" />
    </Canvas>
  );
}
