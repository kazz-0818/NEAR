import { useEffect, useId, useRef, useState } from "react";
import type { ShowcaseAgent } from "../types/showcase";
import { AgentIcon } from "./AgentIcon";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface OrbitAgentHubProps {
  agent: ShowcaseAgent;
  iconSizeClass: string;
}

export function OrbitAgentHub({ agent, iconSizeClass }: OrbitAgentHubProps) {
  const [open, setOpen] = useState(false);
  const hubRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const bubbleId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!hubRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={hubRef}
      className="orbit-agent-hub absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2"
    >
      <button
        type="button"
        className={`orbit-agent-hub-btn group relative flex items-center justify-center rounded-full border-0 bg-transparent p-0 ${open ? "is-open" : ""}`}
        aria-expanded={open}
        aria-controls={bubbleId}
        aria-label={`${agent.kana}の挨拶`}
        onClick={() => setOpen((v) => !v)}
      >
        <div
          id={bubbleId}
          className="orbit-agent-bubble pointer-events-none absolute bottom-[calc(100%+0.65rem)] left-1/2 z-40 w-max max-w-[13.5rem] -translate-x-1/2 sm:max-w-[15rem]"
          role="status"
          aria-live="polite"
        >
          <div
            className="orbit-agent-bubble-panel relative rounded-lg border px-3 py-2.5 text-left backdrop-blur-md sm:px-3.5 sm:py-3"
            style={{
              borderColor: `${agent.accent}66`,
              boxShadow: `0 0 24px ${agent.accent}33, inset 0 1px 0 rgba(255,255,255,0.08)`,
            }}
          >
            <span
              className="mb-1 block font-display text-[8px] tracking-[0.28em] uppercase sm:text-[9px]"
              style={{ color: agent.accent }}
            >
              {agent.code}
            </span>
            <p className="text-[11px] leading-relaxed text-slate-100 sm:text-xs">{agent.greeting}</p>
          </div>
          <div
            className="orbit-agent-bubble-tail absolute top-full left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-[3px] rotate-45 border-r border-b"
            style={{
              borderColor: `${agent.accent}66`,
              background: "rgba(12, 14, 22, 0.92)",
            }}
            aria-hidden
          />
        </div>

        <div
          className="pointer-events-none absolute -inset-2 rounded-full opacity-30 transition-opacity duration-300 group-hover:opacity-50 group-[.is-open]:opacity-50"
          style={{ border: `1px solid ${agent.accent}44` }}
        />
        <AgentIcon
          agentId={agent.id}
          alt={agent.displayName}
          glow={agent.accent}
          className={`orbit-agent-icon relative rounded-full transition-transform duration-300 ease-out ${iconSizeClass} ${reduced ? "" : "group-hover:scale-[1.14] group-[.is-open]:scale-[1.14]"}`}
        />
      </button>
    </div>
  );
}
