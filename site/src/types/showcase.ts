export type CapabilityStatus = "live" | "evolved" | "planned";

export interface ShowcaseCapability {
  id: string;
  label: string;
  status: CapabilityStatus;
  since?: string;
  highlight?: boolean;
}

export interface EvolutionEntry {
  date: string;
  title: string;
  summary: string;
}

export interface ShowcaseAgent {
  id: string;
  code: string;
  kana: string;
  department: string;
  displayName: string;
  role: string;
  description: string;
  accent: string;
  handoffRules: string[];
  capabilities: ShowcaseCapability[];
  evolutionLog: EvolutionEntry[];
}

export interface PhaseItem {
  id: number;
  title: string;
  summary: string;
  status: "done" | "active" | "upcoming";
}

export interface HandoffEdge {
  from: string;
  to: string;
  label: string;
}

export interface ShowcaseData {
  meta: {
    title: string;
    tagline: string;
    subtitle: string;
  };
  agents: ShowcaseAgent[];
  handoffEdges: HandoffEdge[];
  phases: PhaseItem[];
}
