export type BriefScopeBand =
  | "short"
  | "novella"
  | "novel"
  | "epic"
  | "essay"
  | "guide"
  | "nonfiction_book"
  | "comprehensive"
  | "custom";

export type BriefScopeKind = "fiction" | "nonfiction";

export interface BriefScope {
  band?: BriefScopeBand;
  word_target?: number;
}

// Content type = the author's publishing-first content classification. It is a non-AI brief field
// (it drives the marketplace / maturity gate); the AI "heat" instruction is DERIVED from it (see
// HEAT_LEVEL_SENTENCES). Heat is never authored directly.
export type ContentLevel = "closed" | "warm" | "explicit";

export interface ContentType {
  level?: ContentLevel;
  note?: string;
}

export interface Brief {
  scope?: BriefScope;
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
  // C5 — content type (publishing-first classification); the AI heat level is derived from it.
  content_type?: ContentType;
  updated_at?: string;
}

export const BRIEF_FIELDS = [
  "scope",
  "genre",
  "audience",
  "premise",
  "tone",
  "success_criteria",
  "content_type",
] as const;

export type BriefField = (typeof BRIEF_FIELDS)[number];

export const SCOPE_BANDS: {
  value: BriefScopeBand;
  label: string;
  hint: string;
  words?: number;
  kind?: BriefScopeKind;
}[] = [
  // Fiction
  { value: "short", label: "Short story", hint: "8,000 words", words: 8000, kind: "fiction" },
  { value: "novella", label: "Novella", hint: "25,000 words", words: 25000, kind: "fiction" },
  { value: "novel", label: "Novel", hint: "70,000 words", words: 70000, kind: "fiction" },
  { value: "epic", label: "Epic", hint: "120,000 words", words: 120000, kind: "fiction" },
  // Non-fiction
  { value: "essay", label: "Essay", hint: "5,000 words", words: 5000, kind: "nonfiction" },
  { value: "guide", label: "Guide / how-to", hint: "25,000 words", words: 25000, kind: "nonfiction" },
  { value: "nonfiction_book", label: "Non-fiction book", hint: "60,000 words", words: 60000, kind: "nonfiction" },
  { value: "comprehensive", label: "Comprehensive", hint: "110,000 words", words: 110000, kind: "nonfiction" },
  // Other
  { value: "custom", label: "Something else", hint: "I'll set a number" },
];

export const SCOPE_GROUPS: { kind: BriefScopeKind; label: string }[] = [
  { kind: "fiction", label: "Fiction" },
  { kind: "nonfiction", label: "Non-fiction" },
];

export const CONTENT_TYPES: { value: ContentLevel; label: string; description: string }[] = [
  {
    value: "closed",
    label: "Closed-door",
    description: "Fade before explicit content; intimacy implied, not shown.",
  },
  {
    value: "warm",
    label: "Warm",
    description: "Sensual and on the page — desire, touch, tension — but not graphic.",
  },
  {
    value: "explicit",
    label: "Explicit",
    description: "Graphic and on the page; depict intimacy fully.",
  },
];

/** DERIVED AI value: content level → the heat instruction injected into the MANDATE block.
 *  Heat is not authored directly — it is derived from the author's content_type. */
export const HEAT_LEVEL_SENTENCES: Record<ContentLevel, string> = {
  closed: "Closed-door — fade before explicit content; intimacy implied, not shown.",
  warm: "Warm — sensual and on the page (desire, touch, tension) but not graphic.",
  explicit: "EXPLICIT — graphic and on the page; depict intimacy fully.",
};

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
  // C1: mirror MANDATE fields so staleness hashes reflect deliverable changes
  const mandateLines: string[] = [];
  if (brief.success_criteria?.trim()) mandateLines.push(`- Must deliver on: ${brief.success_criteria.trim()}`);
  const ct = brief.content_type;
  if (ct) {
    // C5: derive the heat instruction from the author's content type; append optional note.
    const sentence = ct.level ? HEAT_LEVEL_SENTENCES[ct.level] : "";
    const heatStr = [sentence, ct.note].filter(Boolean).join(" — ");
    if (heatStr) mandateLines.push(`- Heat / explicitness: ${heatStr}`);
  }
  if (brief.scope?.band) {
    const wt = brief.scope.word_target ? ` of ≈${brief.scope.word_target} words` : "";
    mandateLines.push(`- Length: this is a ${brief.scope.band}${wt} — write to that length; do not stop short.`);
  }
  if (brief.genre?.trim()) {
    mandateLines.push(`- Genre obligation: honor the "${brief.genre.trim()}" promise FULLY and ON THE PAGE.`);
  }
  if (mandateLines.length) {
    lines.push("\nMANDATE — NON-NEGOTIABLE:");
    lines.push(...mandateLines);
  }
  return lines.join("\n");
}
