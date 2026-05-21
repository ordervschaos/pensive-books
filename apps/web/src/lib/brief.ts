export type BriefScopeBand = "short" | "novella" | "novel" | "epic" | "custom";

export interface BriefScope {
  band?: BriefScopeBand;
  word_target?: number;
}

export interface Brief {
  scope?: BriefScope;
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
  updated_at?: string;
}

export const BRIEF_FIELDS = [
  "scope",
  "genre",
  "audience",
  "premise",
  "tone",
  "success_criteria",
] as const;

export type BriefField = (typeof BRIEF_FIELDS)[number];

export const SCOPE_BANDS: { value: BriefScopeBand; label: string; hint: string; words?: number }[] = [
  { value: "short", label: "Short story", hint: "up to 10k words", words: 8000 },
  { value: "novella", label: "Novella", hint: "10–40k words", words: 25000 },
  { value: "novel", label: "Novel", hint: "40–100k words", words: 70000 },
  { value: "epic", label: "Epic", hint: "100k+ words", words: 120000 },
  { value: "custom", label: "Something else", hint: "I'll set a number" },
];

export const GENRE_SUGGESTIONS = [
  "Literary fiction",
  "Memoir",
  "Mystery",
  "Sci-fi",
  "Fantasy",
  "Romance",
  "Self-help",
  "Poetry",
  "Essays",
  "Technical",
  "Children's",
];

export const TONE_SUGGESTIONS = [
  "warm",
  "biting",
  "academic",
  "plainspoken",
  "lyrical",
  "playful",
  "melancholy",
  "urgent",
];

export function isFieldFilled(brief: Brief | null | undefined, field: BriefField): boolean {
  if (!brief) return false;
  const value = brief[field];
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "object") {
    return Object.values(value).some((v) =>
      typeof v === "string" ? v.trim().length > 0 : v != null
    );
  }
  return true;
}

export function computeCompletion(brief: Brief | null | undefined): number {
  if (!brief) return 0;
  return BRIEF_FIELDS.reduce((n, f) => (isFieldFilled(brief, f) ? n + 1 : n), 0);
}

export function mergeBrief(current: Brief | null | undefined, patch: Partial<Brief>): Brief {
  const next: Brief = { ...(current ?? {}), ...patch, updated_at: new Date().toISOString() };
  for (const field of BRIEF_FIELDS) {
    if (next[field] == null) continue;
    if (!isFieldFilled(next, field)) delete next[field];
  }
  return next;
}

export function bandLabel(band: BriefScopeBand | undefined): string | null {
  if (!band) return null;
  return SCOPE_BANDS.find((b) => b.value === band)?.label ?? null;
}

export function scopeSummary(scope: BriefScope | undefined): string | null {
  if (!scope) return null;
  const parts: string[] = [];
  const label = bandLabel(scope.band);
  if (label) parts.push(label);
  if (scope.word_target) parts.push(`≈${scope.word_target.toLocaleString()} words`);
  return parts.length ? parts.join(" · ") : null;
}

export function briefToPromptContext(brief: Brief | null | undefined): string | null {
  if (!brief || computeCompletion(brief) === 0) return null;
  const lines: string[] = ["Author's creative brief for this book:"];
  const scope = scopeSummary(brief.scope);
  if (scope) lines.push(`- Scope: ${scope}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.join("\n");
}
