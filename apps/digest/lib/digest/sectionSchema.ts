import type { Section, SectionKind } from "./types";

// THE field contract for every section kind: which fields exist, which are required, what each MEANS, and
// how a form value becomes a Section property. One declaration, three consumers:
//
//   AddSectionForm.tsx  → renders the inputs (labels, hints, defaults, required marks)
//   actions.ts          → parses FormData into a Section, and REFUSES an incomplete one
//   (anything later)    → a per-section "test" button, an importer, an API — all get the contract for free
//
// This exists because the same knowledge used to live in three places — the TS interface in `types.ts`, the
// JSX in the form, and the parse branch in `addSection`. Adding a field meant three edits, and forgetting
// one drifted silently. That is the same multi-mirror drift `dnaSchema.ts` was introduced to kill on the
// DNA side; this is the same move for digest sections.
//
// It is PURE DATA on purpose — no parse callbacks. A `type` tag that both sides interpret keeps the module
// importable from a client component without dragging server code across the boundary, and keeps the schema
// something you can read top-to-bottom as documentation.
//
// One rule that makes the whole thing work: **`name` is both the form field name AND the Section property
// name.** Fields are scoped per-kind and only one kind renders at a time, so there is no collision to dodge
// and no rename table to maintain. (`query` appearing under both `search` and `ranked` is the same property
// meaning the same thing — that is a feature, not a clash.)

export type FieldType =
  | "text" // free string
  | "number" // positive integer; 0/blank means "unset", not zero
  | "select" // one of `options`
  | "urls" // whitespace/comma separated, http(s) only
  | "list"; // whitespace/comma separated, any non-empty token

export interface Field {
  /** Form field name AND the Section property it becomes. */
  name: string;
  label: string;
  type: FieldType;
  /** Blocks submission when empty. Enforced server-side; the form only marks it. */
  required?: boolean;
  /**
   * Required for only some values of a sibling field. Exactly one real case — `ranked.targets` is
   * meaningless for `hn`/`lobsters` (they have no sub-feed) and mandatory for the other three — so this is a
   * named special case rather than a general rule engine.
   */
  requiredWhen?: { field: string; in: readonly string[] };
  /** What this field MEANS. Shown under the input; the reason someone can fill the form without guessing. */
  hint?: string;
  placeholder?: string;
  default?: string | number;
  options?: ReadonlyArray<{ value: string; label: string }>;
}

// Shared by every kind (SectionBase). Kept separate so a kind's list is only what makes IT different.
export const BASE_FIELDS: readonly Field[] = [
  {
    name: "title",
    label: "Title",
    type: "text",
    required: true,
    placeholder: "What's new in AI writing tools",
    hint: "Becomes the section heading in the delivered issue.",
  },
] as const;

export const SECTION_FIELDS: Record<SectionKind, readonly Field[]> = {
  feed: [
    {
      name: "urls",
      label: "Feed URLs",
      type: "urls",
      required: true,
      placeholder: "https://example.com/feed.xml",
      hint: "Whitespace or comma separated. Several feeds in one section are read round-robin, so a daily publisher can't crowd out a monthly one.",
    },
  ],

  ranked: [
    {
      name: "source",
      label: "Source",
      type: "select",
      required: true,
      default: "hn",
      options: [
        { value: "hn", label: "hn — Hacker News above a points floor" },
        { value: "arxiv", label: "arxiv — new papers by category (primary sources)" },
        { value: "github", label: "github — releases of repos you follow" },
        { value: "reddit", label: "reddit — top of a subreddit, last 24h" },
        { value: "lobsters", label: "lobsters — hottest" },
      ],
    },
    {
      name: "targets",
      label: "Targets",
      type: "list",
      requiredWhen: { field: "source", in: ["arxiv", "github", "reddit"] },
      placeholder: "cs.CL, cs.AI  ·  anthropics/claude-code  ·  r/writing",
      hint: "arXiv categories, owner/repo, or subreddits. Not used by hn or lobsters, which have no sub-feed.",
    },
    {
      name: "min_score",
      label: "Min score",
      type: "number",
      placeholder: "100",
      hint: "hn, reddit and lobsters only — the points floor below which an item is ignored.",
    },
    {
      name: "query",
      label: "Query",
      type: "text",
      placeholder: "local-first software",
      hint: "hn and arxiv only. Blank means the whole front page / category.",
    },
  ],

  inbox: [
    {
      name: "senders",
      label: "Only from",
      type: "list",
      placeholder: "stratechery.com, hello@newsletter.dev",
      hint: "Addresses or domains, matched as substrings. Blank means everything that arrives at this digest's address.",
    },
    {
      name: "days",
      label: "Look back (days)",
      type: "number",
      default: 2,
      hint: "How far back to read the mailbox.",
    },
  ],

  video: [
    {
      name: "channels",
      label: "Channels",
      type: "list",
      required: true,
      placeholder: "https://youtube.com/@veritasium, https://feeds.example/podcast.xml",
      hint: "YouTube urls or @handles, or podcast RSS. A transcript is fetched where one exists.",
    },
    { name: "days", label: "Look back (days)", type: "number", default: 3 },
  ],

  readwise: [
    {
      name: "mode",
      label: "Draw",
      type: "select",
      required: true,
      default: "review",
      options: [
        { value: "review", label: "review — Readwise's own daily pick" },
        { value: "random", label: "random — resurface from your library" },
      ],
      hint: "Needs Readwise connected on account settings. Quotes are printed verbatim; no model reads them.",
    },
    {
      name: "category",
      label: "From",
      type: "select",
      default: "",
      options: [
        { value: "", label: "everything" },
        { value: "books", label: "books" },
        { value: "articles", label: "articles" },
        { value: "podcasts", label: "podcasts" },
        { value: "tweets", label: "tweets" },
      ],
      hint: "random only — which shelf to draw from. Ignored by the review draw.",
    },
  ],

  unread: [
    {
      name: "min_age_days",
      label: "Skip anything newer than (days)",
      type: "number",
      default: 3,
      hint: "Keeps this out of the way of the sections still considering those posts.",
    },
    { name: "max_age_days", label: "…or older than (days)", type: "number", default: 30 },
  ],

  sitewatch: [
    {
      name: "urls",
      label: "Page URLs",
      type: "urls",
      required: true,
      placeholder: "https://example.com/syllabus",
      hint: "Whitespace or comma separated. Speaks only when the extracted text changes — silence means nothing moved.",
    },
  ],

  search: [
    {
      name: "query",
      label: "Search query",
      type: "text",
      required: true,
      placeholder: "AI writing tools launches and research",
      hint: "The one paid gather path, and it bills whether or not it finds anything. Needs the toggle on this digest's Settings tab.",
    },
  ],

  quiz: [
    {
      name: "over",
      label: "Quiz which issue",
      type: "select",
      required: true,
      default: "previous",
      options: [
        { value: "previous", label: "the previous issue — retrieval practice" },
        { value: "today", label: "today's issue — a self-check at the end" },
      ],
    },
  ],

  prompt: [],
};

// ---------------------------------------------------------------------------------------------------
// Interpretation — shared by both sides so "what this field means" can't diverge from "how it's read".
// ---------------------------------------------------------------------------------------------------

const SPLIT = /[\s,]+/;

/**
 * Flatten a value of any shape into the raw string `parseField` expects.
 *
 * A form only ever produces strings; anything else calling a command (an agent tool, an importer, a test)
 * naturally holds native values — `urls: ["https://a", "https://b"]`, `days: 3`. Rather than teach those
 * callers to pre-format, they hand over what they have and it is flattened HERE, so `parseField` stays the
 * single interpreter of what a field means. Joining an array with ", " round-trips exactly, because SPLIT
 * treats commas and whitespace the same.
 */
export function normalizeFieldValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Coerce one raw form value by its declared type. `undefined` means "not set" — never a zero or an "". */
export function parseField(field: Field, raw: string): string | number | string[] | undefined {
  const value = (raw ?? "").trim();
  switch (field.type) {
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }
    case "urls":
      return value.split(SPLIT).filter((u) => /^https?:\/\//.test(u));
    case "list":
      return value.split(SPLIT).filter(Boolean);
    case "select":
      // "" is a legitimate select value meaning "no filter" (readwise category), so it stays undefined
      // rather than being stored as an empty string.
      return value || undefined;
    default:
      return value || undefined;
  }
}

// "" counts as empty, including when it arrives as a field's own default. `readwise.category` defaults to ""
// meaning "the whole vault" — that is the ABSENCE of a filter, and the type says `category?:`, so it must be
// omitted from the stored jsonb rather than written as an empty string the adapter would then have to
// special-case.
function isEmpty(v: string | number | string[] | undefined): boolean {
  return v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** True if this field must be filled, given what the rest of the form says. */
export function isRequired(field: Field, values: Record<string, unknown>): boolean {
  if (field.required) return true;
  const when = field.requiredWhen;
  return Boolean(when && when.in.includes(String(values[when.field] ?? "")));
}

/**
 * Parse a kind's fields out of raw form values and report what's missing.
 *
 * The missing-field check is the point of the whole module. Before it, a `feed` with no URLs or a `sitewatch`
 * with no urls saved happily and then gathered nothing every morning, forever — a section that cannot
 * possibly work, with no signal anywhere. An empty `search` query was worse: it still billed an Opus call to
 * produce nothing.
 */
export function parseSectionFields(
  kind: SectionKind,
  raw: (name: string) => string,
): { values: Record<string, unknown>; missing: string[] } {
  const fields = [...BASE_FIELDS, ...SECTION_FIELDS[kind]];
  const values: Record<string, unknown> = {};

  for (const field of fields) {
    const parsed = parseField(field, raw(field.name));
    const fallback = parsed === undefined && field.default !== undefined ? field.default : parsed;
    if (!isEmpty(fallback as never)) values[field.name] = fallback;
  }

  // Requiredness is evaluated AFTER every value is in, because `requiredWhen` reads a sibling.
  const missing = fields
    .filter((f) => isRequired(f, values) && isEmpty(values[f.name] as never))
    .map((f) => f.label);

  return { values, missing };
}

/** The fields for a kind, base first — what a form should render, in order. */
export function fieldsFor(kind: SectionKind): readonly Field[] {
  return [...BASE_FIELDS, ...SECTION_FIELDS[kind]];
}

/** Existing value of a field on a saved section, formatted back into what the input expects. */
export function fieldValue(section: Section | undefined, field: Field): string {
  if (!section) return field.default === undefined ? "" : String(field.default);
  const v = (section as unknown as Record<string, unknown>)[field.name];
  if (v === undefined || v === null) return field.default === undefined ? "" : String(field.default);
  return Array.isArray(v) ? v.join(", ") : String(v);
}
