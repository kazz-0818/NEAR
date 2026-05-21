import { iconBase } from "../lib/agents";

interface AgentIconProps {
  agentId: string;
  alt: string;
  className?: string;
  glow?: string;
}

export function AgentIcon({ agentId, alt, className = "", glow }: AgentIconProps) {
  const base = iconBase(agentId);
  return (
    <div
      className={`relative overflow-hidden rounded-2xl ${className}`}
      style={glow ? { boxShadow: `0 0 48px ${glow}55, 0 0 80px ${glow}22` } : undefined}
    >
      <picture>
        <source srcSet={`${base}.webp`} type="image/webp" />
        <img
          src={`${base}.png`}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      </picture>
    </div>
  );
}
