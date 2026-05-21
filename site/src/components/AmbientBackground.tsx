import { useReducedMotion } from "../hooks/useReducedMotion";

const ORBS = [
  { color: "#22d3ee", left: "10%", top: "20%", size: 280, delay: 0 },
  { color: "#e879f9", left: "75%", top: "15%", size: 220, delay: 2 },
  { color: "#fbbf24", left: "60%", top: "70%", size: 260, delay: 4 },
  { color: "#a78bfa", left: "15%", top: "65%", size: 200, delay: 1 },
  { color: "#fb7185", left: "85%", top: "55%", size: 180, delay: 3 },
];

export function AmbientBackground() {
  const reduced = useReducedMotion();
  if (reduced) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      {ORBS.map((orb, i) => (
        <div
          key={i}
          className="ambient-orb absolute rounded-full blur-3xl"
          style={{
            left: orb.left,
            top: orb.top,
            width: orb.size,
            height: orb.size,
            background: `radial-gradient(circle, ${orb.color}22 0%, transparent 70%)`,
            animationDelay: `${orb.delay}s`,
          }}
        />
      ))}
      <div className="aurora-shift absolute inset-0 opacity-40" />
    </div>
  );
}
