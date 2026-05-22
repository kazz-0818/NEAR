import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { usePauseAnimationsOffscreen } from "../hooks/usePauseAnimationsOffscreen";

const ORBS = [
  { color: "#22d3ee", left: "8%", top: "18%", size: 300 },
  { color: "#e879f9", left: "72%", top: "12%", size: 260 },
  { color: "#fbbf24", left: "58%", top: "72%", size: 280 },
  { color: "#a78bfa", left: "12%", top: "62%", size: 220 },
  { color: "#fb7185", left: "88%", top: "48%", size: 180 },
];

const MOBILE_ORB_COUNT = 3;

/** 全ページ共通の固定宇宙背景（CSS のみ・Canvas なし） */
export function CosmicBackground() {
  const rootRef = useRef<HTMLDivElement>(null);
  usePauseAnimationsOffscreen(rootRef);
  const reduced = useReducedMotion();
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const orbs = mobile ? ORBS.slice(0, MOBILE_ORB_COUNT) : ORBS;

  return (
    <div
      ref={rootRef}
      className="cosmic-space pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      <div className="cosmic-space-base absolute inset-0" />
      <div className="cosmic-space-stars absolute inset-0" />
      <div className="cosmic-space-aurora absolute inset-0" />
      <div className="cosmic-space-grid absolute inset-0 opacity-[0.14]" />

      {!reduced &&
        orbs.map((orb, i) => (
          <div
            key={i}
            className="ambient-orb absolute rounded-full blur-2xl"
            style={{
              left: orb.left,
              top: orb.top,
              width: orb.size,
              height: orb.size,
              background: `radial-gradient(circle, ${orb.color}26 0%, transparent 70%)`,
              animationDelay: `${i * 1.4}s`,
            }}
          />
        ))}

      <div className="cosmic-space-vignette absolute inset-0" />
    </div>
  );
}
