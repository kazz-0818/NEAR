import { useRef, useMemo, Suspense, Component, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture, Billboard } from "@react-three/drei";
import * as THREE from "three";
import type { ShowcaseAgent } from "../types/showcase";
import { iconBase } from "../lib/agents";
import { RING_ORDER } from "../lib/colors";
import { agentSectionId, scrollToId } from "../lib/agents";

const ORBIT = {
  radius: 3.4,
  yAmp: 0.55,
  speed: 0.32,
  size: 1.15,
} as const;

interface OrbitAgent {
  agent: ShowcaseAgent;
  index: number;
  texture: THREE.Texture;
}

function FlyingAgentMesh({ agent, index, texture }: OrbitAgent) {
  const group = useRef<THREE.Group>(null);
  const hover = useRef(false);
  const scale = useRef(1);
  const phase = (index / 5) * Math.PI * 2;

  useFrame((state, delta) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    const angle = phase + t * ORBIT.speed;
    const fly = Math.sin(t * 1.1 + phase * 2) * ORBIT.yAmp;
    const wobble = Math.cos(t * 0.7 + phase) * 0.12;

    group.current.position.set(
      Math.cos(angle) * ORBIT.radius,
      fly + wobble,
      Math.sin(angle) * ORBIT.radius * 0.55 - 0.5,
    );

    const target = hover.current ? 1.22 : 1;
    scale.current += (target - scale.current) * Math.min(delta * 8, 1);
    group.current.scale.setScalar(scale.current);
  });

  return (
    <Billboard ref={group}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          scrollToId(agentSectionId(agent));
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          hover.current = true;
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          hover.current = false;
          document.body.style.cursor = "";
        }}
      >
        <planeGeometry args={[ORBIT.size, ORBIT.size]} />
        <meshBasicMaterial
          map={texture}
          transparent
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0, -0.02]} scale={1.15}>
        <planeGeometry args={[ORBIT.size, ORBIT.size]} />
        <meshBasicMaterial
          color={agent.accent}
          transparent
          opacity={0.25}
          depthWrite={false}
        />
      </mesh>
    </Billboard>
  );
}

function AgentsInner({ agents }: { agents: ShowcaseAgent[] }) {
  const byId = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a])),
    [agents],
  );
  const urls = useMemo(
    () => RING_ORDER.map((id) => `${iconBase(id)}.webp`),
    [],
  );
  const textures = useTexture(urls);
  const ordered = RING_ORDER.map((id) => byId[id]).filter(Boolean) as ShowcaseAgent[];

  return (
    <>
      {ordered.map((agent, i) => (
        <FlyingAgentMesh
          key={agent.id}
          agent={agent}
          index={i}
          texture={textures[i]!}
        />
      ))}
    </>
  );
}

function CenterCore() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.z = state.clock.elapsedTime * 0.15;
  });
  return (
    <mesh ref={ref} position={[0, 0, -2]}>
      <ringGeometry args={[0.9, 1.05, 32]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.08} />
    </mesh>
  );
}

function LightParticles() {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 320;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 12;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 8;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 6;
    }
    return arr;
  }, []);

  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = state.clock.elapsedTime * 0.02;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.035}
        color="#94a3b8"
        transparent
        opacity={0.45}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

function SoftParallax() {
  const { camera } = useThree();
  const target = useRef({ x: 0, y: 0 });

  useFrame((state) => {
    const mx = state.pointer.x * 0.15;
    const my = state.pointer.y * 0.08;
    target.current.x += (mx - target.current.x) * 0.04;
    target.current.y += (my - target.current.y) * 0.04;
    camera.position.x = target.current.x;
    camera.position.y = target.current.y;
    camera.lookAt(0, 0, 0);
  });

  return null;
}

class AgentsErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

interface FlyingAgents3DProps {
  agents: ShowcaseAgent[];
}

export function FlyingAgents3D({ agents }: FlyingAgents3DProps) {
  return (
    <>
      <ambientLight intensity={0.55} />
      <pointLight position={[2, 3, 4]} intensity={0.9} color="#f8fafc" />
      <LightParticles />
      <CenterCore />
      <SoftParallax />
      <AgentsErrorBoundary>
        <Suspense fallback={null}>
          <AgentsInner agents={agents} />
        </Suspense>
      </AgentsErrorBoundary>
    </>
  );
}
