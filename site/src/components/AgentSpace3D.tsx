import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { AdditiveBlending, type Points } from "three";
import { hexToRgb } from "../lib/hexColor";

const STAR_COUNT = 720;
const NEBULA_COUNT = 280;

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function fillPositions(rand: () => number, count: number, spread: [number, number, number]) {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = (rand() - 0.5) * spread[0];
    arr[i * 3 + 1] = (rand() - 0.5) * spread[1];
    arr[i * 3 + 2] = (rand() - 0.5) * spread[2];
  }
  return arr;
}

function hashSeed(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i);
  return Math.abs(h) || 1;
}

interface SpaceLayersProps {
  accent: string;
  agentId: string;
}

function SpaceLayers({ accent, agentId }: SpaceLayersProps) {
  const starsRef = useRef<Points>(null);
  const nebulaRef = useRef<Points>(null);
  const [ar, ag, ab] = hexToRgb(accent);

  const { starPos, nebulaPos } = useMemo(() => {
    const rand = seededRandom(hashSeed(agentId));
    return {
      starPos: fillPositions(rand, STAR_COUNT, [22, 14, 10]),
      nebulaPos: fillPositions(rand, NEBULA_COUNT, [16, 10, 8]),
    };
  }, [agentId]);

  useFrame((_, delta) => {
    const t = delta * 0.018;
    if (starsRef.current) starsRef.current.rotation.y += t;
    if (nebulaRef.current) {
      nebulaRef.current.rotation.y -= t * 0.35;
      nebulaRef.current.rotation.x += t * 0.12;
    }
  });

  return (
    <>
      <points ref={starsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[starPos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.022}
          color="#e2e8f0"
          transparent
          opacity={0.55}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
      <points ref={nebulaRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[nebulaPos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.045}
          color={[ar, ag, ab]}
          transparent
          opacity={0.28}
          sizeAttenuation
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </points>
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[fillPositions(seededRandom(hashSeed(agentId) + 99), 120, [18, 12, 9]), 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.012}
          color="#7dd3fc"
          transparent
          opacity={0.35}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
    </>
  );
}

interface AgentSpace3DProps {
  accent: string;
  agentId: string;
}

export function AgentSpace3D({ accent, agentId }: AgentSpace3DProps) {
  return (
    <Canvas
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
      dpr={[1, 1.25]}
      gl={{
        alpha: true,
        antialias: false,
        powerPreference: "low-power",
      }}
      camera={{ position: [0, 0, 5.5], fov: 58 }}
      style={{ opacity: 0.92 }}
    >
      <fog attach="fog" args={["#030308", 6, 18]} />
      <SpaceLayers accent={accent} agentId={agentId} />
    </Canvas>
  );
}
