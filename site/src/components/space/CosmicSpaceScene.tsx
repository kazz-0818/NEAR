import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  type Points,
} from "three";
import { hexToRgb } from "../../lib/hexColor";
import { fillPositions, fillWarpStream, seededRandom } from "./cosmicUtils";

export type CosmicVariant = "hero" | "agent";

interface CosmicSpaceSceneProps {
  accent: string;
  seed: number;
  variant?: CosmicVariant;
}

function useSeedRand(seed: number) {
  return useMemo(() => seededRandom(seed), [seed]);
}

function StarLayers({ seed, dense }: { seed: number; dense: boolean }) {
  const far = useRef<Points>(null);
  const mid = useRef<Points>(null);
  const bright = useRef<Points>(null);
  const rand = useSeedRand(seed);

  const layers = useMemo(
    () => ({
      far: fillPositions(rand, dense ? 1400 : 1100, [28, 18, 14]),
      mid: fillPositions(rand, dense ? 520 : 380, [20, 12, 10]),
      bright: fillPositions(rand, dense ? 180 : 120, [14, 9, 8]),
    }),
    [rand, dense],
  );

  useFrame((state, delta) => {
    const t = delta * 0.012;
    const sway = Math.sin(state.clock.elapsedTime * 0.2) * 0.08;
    if (far.current) {
      far.current.rotation.y += t * 0.35;
      far.current.rotation.x = sway * 0.15;
    }
    if (mid.current) {
      mid.current.rotation.y -= t * 0.55;
    }
    if (bright.current) {
      bright.current.rotation.y += t * 0.25;
    }
  });

  return (
    <>
      <points ref={far}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[layers.far, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.018}
          color="#f8fafc"
          transparent
          opacity={0.75}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
      <points ref={mid}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[layers.mid, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.032}
          color="#67e8f9"
          transparent
          opacity={0.55}
          sizeAttenuation
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </points>
      <points ref={bright}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[layers.bright, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.065}
          color="#e0e7ff"
          transparent
          opacity={0.9}
          sizeAttenuation
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </points>
    </>
  );
}

function WarpStream({ seed, accent }: { seed: number; accent: string }) {
  const ref = useRef<Points>(null);
  const [ar, ag, ab] = hexToRgb(accent);
  const rand = useSeedRand(seed + 17);

  const initial = useMemo(() => fillWarpStream(rand, 420), [rand]);

  useFrame((_, delta) => {
    const pts = ref.current;
    if (!pts) return;
    const attr = pts.geometry.attributes.position as BufferAttribute;
    const arr = attr.array as Float32Array;
    const speed = delta * 2.8;
    for (let i = 0; i < arr.length / 3; i++) {
      arr[i * 3 + 2] += speed;
      if (arr[i * 3 + 2] > 6) arr[i * 3 + 2] = -11;
    }
    attr.needsUpdate = true;
    pts.rotation.z += delta * 0.03;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[initial, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        color={[ar, ag, ab]}
        transparent
        opacity={0.5}
        sizeAttenuation
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}

function EnergyRings({ accent, seed }: { accent: string; seed: number }) {
  const g1 = useRef<Group>(null);
  const g2 = useRef<Group>(null);
  const [r, g, b] = hexToRgb(accent);
  const color = new Color(r, g, b);

  useFrame((state) => {
    const e = state.clock.elapsedTime;
    if (g1.current) {
      g1.current.rotation.z = e * 0.12 + seed * 0.01;
      g1.current.rotation.x = Math.PI / 2 + Math.sin(e * 0.3) * 0.08;
    }
    if (g2.current) {
      g2.current.rotation.z = -e * 0.18;
      g2.current.rotation.x = Math.PI / 2;
      g2.current.scale.setScalar(1 + Math.sin(e * 0.5) * 0.04);
    }
  });

  return (
    <>
      <group ref={g1} position={[0, 0, -1.5]}>
        <mesh>
          <torusGeometry args={[5.2, 0.018, 12, 96]} />
          <meshBasicMaterial color={color} transparent opacity={0.55} blending={AdditiveBlending} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 3]}>
          <torusGeometry args={[4.1, 0.012, 8, 72]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} blending={AdditiveBlending} />
        </mesh>
      </group>
      <group ref={g2} position={[0, -0.2, 0]}>
        <mesh>
          <torusGeometry args={[3.4, 0.025, 10, 80]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.7}
            wireframe
            blending={AdditiveBlending}
          />
        </mesh>
      </group>
    </>
  );
}

function WarpGrid() {
  const ref = useRef<Group>(null);

  const geometry = useMemo(() => {
    const geo = new BufferGeometry();
    const verts: number[] = [];
    const rings = 10;
    const spokes = 24;
    for (let r = 1; r <= rings; r++) {
      const radius = r * 0.85;
      for (let s = 0; s < spokes; s++) {
        const a1 = (s / spokes) * Math.PI * 2;
        const a2 = ((s + 1) / spokes) * Math.PI * 2;
        verts.push(
          Math.cos(a1) * radius,
          -2.8,
          Math.sin(a1) * radius,
          Math.cos(a2) * radius,
          -2.8,
          Math.sin(a2) * radius,
        );
      }
    }
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      verts.push(0, -2.8, 0, Math.cos(a) * 8.5, -2.8, Math.sin(a) * 8.5);
    }
    geo.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
    return geo;
  }, []);

  useFrame((state, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.08;
      ref.current.position.y = -2.8 + Math.sin(state.clock.elapsedTime * 0.4) * 0.06;
    }
  });

  return (
    <group ref={ref}>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color="#22d3ee" transparent opacity={0.22} blending={AdditiveBlending} />
      </lineSegments>
      <lineSegments geometry={geometry} scale={[1.02, 1, 1.02]}>
        <lineBasicMaterial color="#a78bfa" transparent opacity={0.12} blending={AdditiveBlending} />
      </lineSegments>
    </group>
  );
}

function NebulaMist({ accent, seed }: { accent: string; seed: number }) {
  const ref = useRef<Points>(null);
  const [ar, ag, ab] = hexToRgb(accent);
  const rand = useSeedRand(seed + 31);
  const pos = useMemo(() => fillPositions(rand, 520, [18, 12, 14]), [rand]);

  useFrame((state, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y -= delta * 0.04;
    ref.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.15) * 0.1;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.12}
        color={[ar, ag, ab]}
        transparent
        opacity={0.35}
        sizeAttenuation
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}

function HorizonPlane({ accent }: { accent: string }) {
  const [ar, ag, ab] = hexToRgb(accent);
  return (
    <mesh position={[0, 0, -6]} rotation={[0, 0, 0]}>
      <planeGeometry args={[40, 24]} />
      <meshBasicMaterial
        color={[ar * 0.35, ag * 0.35, ab * 0.5]}
        transparent
        opacity={0.18}
        side={DoubleSide}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

function CameraDrift({ variant }: { variant: CosmicVariant }) {
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const amp = variant === "hero" ? 0.22 : 0.16;
    state.camera.position.x = Math.sin(t * 0.18) * amp;
    state.camera.position.y = Math.cos(t * 0.14) * amp * 0.5;
    state.camera.lookAt(0, 0, 0);
  });
  return null;
}

export function CosmicSpaceScene({
  accent,
  seed,
  variant = "agent",
}: CosmicSpaceSceneProps) {
  const dense = variant === "hero";

  return (
    <>
      <fog attach="fog" args={["#020208", 4, 22]} />
      <ambientLight intensity={0.15} />
      <pointLight position={[0, 2, 2]} intensity={0.6} color={accent} distance={14} />
      <pointLight position={[-4, -2, -3]} intensity={0.35} color="#38bdf8" distance={12} />
      <CameraDrift variant={variant} />
      <HorizonPlane accent={accent} />
      <WarpGrid />
      <EnergyRings accent={accent} seed={seed} />
      <StarLayers seed={seed} dense={dense} />
      <NebulaMist accent={accent} seed={seed} />
      <WarpStream seed={seed} accent={accent} />
    </>
  );
}
