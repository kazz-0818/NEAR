import { Canvas } from "@react-three/fiber";
import { CosmicSpaceScene } from "./space/CosmicSpaceScene";

export function HeroParticle3D() {
  return (
    <Canvas
      className="pointer-events-none absolute inset-0 z-[1]"
      dpr={[1, 1.5]}
      gl={{
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      }}
      camera={{ position: [0, 0.15, 5.8], fov: 54 }}
      style={{ opacity: 1 }}
    >
      <CosmicSpaceScene accent="#c4b5fd" seed={42} variant="hero" />
    </Canvas>
  );
}
