import { z } from "zod";

export const userMemoryFactCategorySchema = z.enum([
  "preference",
  "role",
  "workflow",
  "constraint",
  "relationship",
  "other",
]);

export const userMemoryFactSchema = z.object({
  fact: z.string().min(1).max(400),
  category: userMemoryFactCategorySchema.default("other"),
  confidence: z.number().min(0).max(1).default(0.7),
  learned_at: z.string().optional(),
});

export const userMemoryConsolidationSchema = z.object({
  memory_summary: z.string().max(4000),
  memory_facts: z.array(userMemoryFactSchema).max(32),
  call_preference: z.string().max(120).nullable().optional(),
});

export type UserMemoryFact = z.infer<typeof userMemoryFactSchema>;
export type UserMemoryConsolidation = z.infer<typeof userMemoryConsolidationSchema>;

export type UserMemoryRow = {
  line_user_id: string;
  memory_summary: string;
  memory_facts: UserMemoryFact[];
  call_preference: string | null;
  last_consolidated_inbound_id: number | null;
  consolidation_count: number;
  updated_at: string;
};

export type UserMemoryPromptContext = {
  memorySubjectLineUserId: string;
  displayName: string | null;
  adminMemo: string | null;
  memorySummary: string;
  memoryFacts: UserMemoryFact[];
  callPreference: string | null;
};
