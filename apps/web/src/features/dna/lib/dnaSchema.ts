// dnaSchema — the SINGLE SOURCE OF TRUTH for what each node kind's content looks like. One `NODE_SCHEMA`
// object declares every editable/validatable field (its type, whether it's required, its enum, the kind it
// references) and three consumers derive from it instead of re-asserting the shape:
//   • the tree editor    — renders a typed editor per field (DnaTreePage)
//   • the content lints   — validateContent() checks a node against its schema (generation boundary + score)
//   • the completeness    — requiredMissing()/contentCompleteness() count filled vs required fields
// This replaces the old drift where EDIT_FIELDS (editor), the dna-chat prompt, and the TS NodeContent types
// each hand-described the same shape. The TS interfaces in novelDna stay the COMPILE-TIME view; this is the
// RUNTIME view. Structure (parent kind, singletons) lives in novelDna (PARENT_KIND); this owns content.
import { type DnaIssue, type DnaNode, type NodeKind } from "@/features/dna/lib/novelDna";

// ── Field spec ────────────────────────────────────────────────────────────────
// text/list (comma) for free text, ref/refs for id pointers (a dropdown/chip-picker of the right kind),
// select for enums, percent for 0–1 floats, object for nested groups (value_shift, premise shape).
export type FieldType = "text" | "list" | "ref" | "refs" | "select" | "percent" | "number" | "object";
export interface EditSpec {
  key: string; label: string; type?: FieldType; multiline?: boolean;
  refKind?: NodeKind; options?: string[]; fields?: EditSpec[];
  required?: boolean; // load-bearing — a node missing this reads as incomplete (and is rejected at generation)
  // taste = a USER-OWNED, subjective field ("to their taste"): tone, controlling idea, voice style, idiolect.
  // The Voice & Feel panel (DnaTreePage) gathers every taste field into one surface so the author isn't
  // chasing them across four tree depths. Untagged editable fields are shared craft; genOnly = AI-maintained.
  taste?: boolean;
  // genOnly = part of the content CONTRACT (the AI may set it, it appears in the generation prompt) but the
  // tree editor doesn't render a field for it (complex/derived structural data). `note` is a prompt-only
  // shape hint for such fields. editSpecs() filters these out; the schema guide (for the prompt) keeps them.
  genOnly?: boolean; note?: string;
}

const ROLES = ["protagonist", "antagonist", "ally", "love_interest", "minor"];
const POLARITY = ["up", "down"];

// ── The schema (formerly DnaTreePage.EDIT_FIELDS) — now the one place the field shape lives ───────────────
export const NODE_SCHEMA: Partial<Record<NodeKind, EditSpec[]>> = {
  seed: [{ key: "logline", label: "logline", multiline: true, required: true }],
  premise: [
    // genre + tone live on the BRIEF (the book-level contract / MANDATE), not here — they were duplicated
    // onto premise but nothing downstream read them (drift risk only). The premise rung holds only what it
    // genuinely refines: the dramatic question + a flexible shape.
    // The premise's load-bearing minimum: the CENTRAL QUESTION the whole book lives inside. Framed wide
    // on purpose — it can be a PLOT question ("will she escape?") OR a thematic one ("can a single day hold
    // a whole life?"), so the rung stays universal across genre and literary work.
    { key: "dramatic_question", label: "central question", multiline: true, required: true },
    // shape is an OPTIONAL sketch, one rung ABOVE acts (a CONTRACT, same relationship as every rung pair on
    // the ladder — not competing structure). `name` is free text, not an enum, on purpose: a hardcoded
    // 5-part Freytag arc silently biased every beat sheet toward Western three-act shape, with no room for
    // kishōtenketsu, a frame story, or a braided narrative. `movements` is however many beats the CHOSEN
    // shape actually needs (n:1 onto acts one rung down); `ending_feel` is the ending's VALENCE only — the
    // concrete ending itself stays on the pillar (single source of truth; avoid duplicating it here).
    { key: "shape", label: "shape", type: "object", fields: [
      { key: "name", label: "shape name" },
      { key: "movements", label: "movements", type: "list" },
      { key: "ending_feel", label: "ending feel", type: "select", options: ["up", "down", "bittersweet", "ambivalent"] },
    ] },
  ],
  pillar: [{ key: "controlling_idea", label: "idea", multiline: true, required: true, taste: true }, { key: "ending", label: "ending", multiline: true, taste: true }],
  character: [
    { key: "name", label: "name", required: true }, { key: "role", label: "role", type: "select", options: ROLES }, { key: "want", label: "want", multiline: true },
    { key: "need", label: "need", multiline: true }, { key: "wound", label: "wound", multiline: true }, { key: "lie", label: "lie", multiline: true },
    { key: "truth", label: "truth", multiline: true }, { key: "idiolect", label: "idiolect", multiline: true, taste: true }, { key: "tag", label: "tag" },
  ],
  relationship: [
    { key: "a", label: "a", type: "ref", refKind: "character", required: true }, { key: "b", label: "b", type: "ref", refKind: "character", required: true },
    { key: "bond", label: "bond", multiline: true, required: true }, { key: "charge", label: "charge", multiline: true },
  ],
  world_fact: [{ key: "name", label: "name", required: true }, { key: "rule", label: "rule", multiline: true, required: true }, { key: "mechanism", label: "mechanism", multiline: true }, { key: "category", label: "category" }],
  location: [
    { key: "name", label: "name", required: true }, { key: "summary", label: "summary", multiline: true },
    // The sensory palette — what a scene set here SMELLS/SOUNDS/LOOKS like. Carried verbatim into every
    // scene that points at this location, so continuity holds (the nautical harbor reads the same each time).
    { key: "sight", label: "sight", multiline: true }, { key: "sound", label: "sound", multiline: true },
    { key: "smell", label: "smell", multiline: true }, { key: "texture", label: "texture", multiline: true },
    { key: "mood", label: "mood", multiline: true },
  ],
  thread: [{ key: "name", label: "name", required: true }, { key: "kind", label: "kind", type: "select", options: ["mystery", "foreshadow", "setup_payoff", "arc"] }, { key: "promise", label: "promise", multiline: true, required: true }, { key: "payoff", label: "payoff", multiline: true },
    // owner: the node this thread is ABOUT — a game id on the auto-minted game-resolution twin (the
    // reconciler's idempotency key), a character id on a minted ARC thread (the dead_arc lint's join key).
    { key: "owner", label: "owner", genOnly: true, note: "[game or character id] — set on the auto-minted game-resolution / character-arc thread" },
    // waived: the deliberate carry-over gesture (obligation ledger) — this promise is left unpaid ON PURPOSE
    // (a sequel hook). Settles the debt row without a payoff. Set only with the author's explicit consent.
    { key: "waived", label: "waived", genOnly: true, note: "true = deliberately left unpaid (sequel hook) — settles this promise in the obligation ledger; only with the author's consent" }],
  game: [
    { key: "name", label: "name", required: true }, { key: "players", label: "players", type: "refs", refKind: "character" },
    { key: "win_condition", label: "win", multiline: true, required: true }, { key: "lose_condition", label: "lose", multiline: true, required: true }, { key: "stake", label: "stake", multiline: true },
    { key: "governing_rules", label: "rules", type: "refs", refKind: "world_fact" },
    { key: "waived", label: "waived", genOnly: true, note: "true = contest deliberately left undecided (sequel hook) — settles it in the obligation ledger; only with the author's consent" },
  ],
  tentpole: [{ key: "summary", label: "summary", multiline: true, required: true },
    { key: "waived", label: "waived", genOnly: true, note: "true = set-piece deliberately unplaced (cut or deferred) — settles it in the obligation ledger; only with the author's consent" }],
  // meter (docs/novel-dna-meters.md): a named bounded axis (comedy/heat/freedom/game-score) defined once on
  // the pillar. Beats/scenes carry numeric `readings` on it; the engine plots the series + lints its shape.
  meter: [
    { key: "name", label: "name", required: true },
    { key: "kind", label: "kind", type: "select", options: ["value", "game_score", "affect", "relationship", "heat", "comedy", "tension", "custom"] },
    // poles give a bare number meaning (the low/high ends); for game_score they mirror the lose/win condition.
    { key: "poles", label: "poles", type: "object", fields: [{ key: "low", label: "low", multiline: true }, { key: "high", label: "high", multiline: true }] },
    { key: "scale", label: "scale", type: "object", fields: [{ key: "min", label: "min", type: "number" }, { key: "max", label: "max", type: "number" }] },
    // owner OPTIONAL — character|game|relationship. refKind takes one kind, so this is left unconstrained; the
    // editor offers a free ref and novelDna's dangling_ref still checks existence across kinds.
    { key: "owner", label: "owner", type: "ref" },
    // target = the PLANNED curve (sparse word-% anchors). genOnly: the planner sets it, complex shape.
    { key: "target", label: "target", genOnly: true, note: "[{ at: 0..1 word%, value: number }] — the planned curve generation aims at" },
  ],
  voice_profile: [
    { key: "pov", label: "pov", type: "select", options: ["first-person", "third-person-limited", "third-person-omniscient", "second-person"], taste: true },
    { key: "tense", label: "tense", type: "select", options: ["past", "present"], taste: true }, { key: "style", label: "style", multiline: true, required: true, taste: true },
    { key: "constraints", label: "constraints", type: "list", taste: true }, { key: "sample", label: "sample", multiline: true, taste: true },
  ],
  act: [
    { key: "title", label: "title" }, { key: "goal", label: "goal", multiline: true, required: true }, { key: "turning_point", label: "turning point", multiline: true },
    { key: "target_pct", label: "target %", type: "percent" },
    // polarity = the act's MACRO trend (where the value ENDS across the act) — the machine-readable
    // contract the act_value_undelivered lint checks against the act's last beat; from/to stay free text.
    { key: "value", label: "value", type: "object", fields: [
      { key: "name", label: "name" }, { key: "from", label: "from" }, { key: "to", label: "to" },
      { key: "polarity", label: "polarity", type: "select", options: POLARITY },
    ] },
  ],
  beat: [
    { key: "summary", label: "summary", multiline: true, required: true }, { key: "connector", label: "connector", type: "select", options: ["therefore", "but"] },
    { key: "polarity", label: "polarity", type: "select", options: POLARITY },
    // Structural fields (causality §why + promises §what + games) — the reviser sets these; the editor doesn't.
    { key: "threads", label: "threads", genOnly: true, note: "[{ ref: thread id, role: setup|payoff|advance }]" },
    { key: "grounds_in", label: "grounds_in", genOnly: true, note: "[world_fact id] — the rule this turn operates on" },
    { key: "needs", label: "needs", genOnly: true, note: "[state key] this turn DEPENDS on (earned upstream)" },
    { key: "establishes", label: "establishes", genOnly: true, note: "[state key] this turn PRODUCES" },
    { key: "realizes", label: "realizes", genOnly: true, note: "[tentpole id] this beat delivers" },
    { key: "plays", label: "plays", genOnly: true, note: "[game id] this turn advances" },
    { key: "resolves", label: "resolves", genOnly: true, note: "[{ ref: game id, outcome: won|lost }]" },
    { key: "readings", label: "readings", genOnly: true, note: "[{ ref: meter id, value: number }] this turn's level on each meter (a y-value)" },
  ],
  scene: [
    { key: "pov", label: "pov", type: "ref", refKind: "character" }, { key: "loc", label: "loc", type: "ref", refKind: "location" },
    { key: "goal", label: "goal", multiline: true, required: true }, { key: "conflict", label: "conflict", multiline: true }, { key: "outcome", label: "outcome", multiline: true },
    { key: "value_shift", label: "value", type: "object", fields: [
      { key: "value", label: "value" }, { key: "from", label: "from" }, { key: "to", label: "to" }, { key: "polarity", label: "polarity", type: "select", options: POLARITY },
    ] },
    // register = how the book's ONE voice BENDS for this scene only (pace, distance, intensity). The signature
    // stays constant; this knob breaks per-scene monotony. Adjacent scenes should differ so the read never goes flat.
    { key: "register", label: "register", multiline: true, taste: true, note: "how the voice bends here — pace, distance, intensity (e.g. \"clipped, breathless\" / \"slow, elegiac, interior\"). Adjacent scenes should differ." },
    { key: "readings", label: "readings", genOnly: true, note: "[{ ref: meter id, value: number }] this scene's level on each meter (inherited/refined from its beat)" },
    // sketch = the TREATMENT: what/how this page renders, generated BEFORE prose (dna-expand target='sketch').
    // `moves` are WHAT happens (never dialogue lines); `direction` is HOW it's shown. genOnly like the other
    // structured plan fields (threads/readings) — the tree editor doesn't render a form for it.
    { key: "sketch", label: "sketch", genOnly: true, note: "{opening, moves:[{what, thread?, sense?}], exit, direction:{cut:{in,out}, distance(far|mid|close|deep), mode(dialogue|action|interior|description|summary), time(real|compressed|stretched), tension(suspense|mystery|irony)}} — the scene treatment" },
    // observed_establishes / continuity_flags are OUTPUTS of the continuity read (factLedger), not authored plan
    // input — so they're not editor fields here. Phase-1 grounding (docs/scene-ledger.md §1.3): each fact may
    // carry an optional `entity` = the registry node id it's about (n_…), the join key to the plan side.
  ],
};
// The editor renders only the hand-editable fields — structural genOnly fields are prompt/contract-only.
export const editSpecs = (kind: NodeKind): EditSpec[] => (NODE_SCHEMA[kind] ?? []).filter((s) => !s.genOnly);
// The taste (user-owned, subjective) fields for a kind — the atoms the Voice & Feel panel consolidates.
export const tasteSpecs = (kind: NodeKind): EditSpec[] => (NODE_SCHEMA[kind] ?? []).filter((s) => s.taste);

// ── Structural constants (single copy; were duplicated across DnaTreePage + dnaChat) ─────────────────────
export const KIND_LEVEL: Record<NodeKind, number> = {
  seed: 0, premise: 1, pillar: 2, character: 2, relationship: 2, tentpole: 2, world_fact: 2, location: 2, voice_profile: 2, thread: 2, game: 2, meter: 2, act: 3, beat: 4, scene: 5,
};
// The ladder's next kind down — drives the nested adds of a replace_children subtree.
export const LADDER_NEXT: Partial<Record<NodeKind, NodeKind>> = { act: "beat", beat: "scene" };

// ── Content validation (the runtime shape check) ─────────────────────────────────────────────────────────
const isEmpty = (v: unknown): boolean => v == null || v === "" || (Array.isArray(v) && v.length === 0);
// Walk one node's content against its schema: required fields present, enums valid, list/refs really arrays.
// Recurses into object sub-fields. REF RESOLUTION is intentionally NOT here — that's relational (needs the
// whole tree) and already covered by novelDna's dangling_ref. `nodeId` lets callers attribute the issues.
function checkSpecs(specs: EditSpec[], content: Record<string, unknown>, kind: NodeKind, nodeId: string | undefined, partial: boolean): DnaIssue[] {
  const issues: DnaIssue[] = [];
  for (const spec of specs) {
    const raw = content?.[spec.key];
    if (spec.type === "object") {
      issues.push(...checkSpecs(spec.fields ?? [], (raw as Record<string, unknown>) ?? {}, kind, nodeId, partial));
      continue;
    }
    // partial = an edit PATCH: a field simply absent isn't "missing", it's "untouched" — only check what's set.
    if (spec.required && isEmpty(raw)) {
      if (!partial) issues.push({ rule: "missing_field", severity: "error", message: `${kind} is missing required "${spec.key}"`, nodeId });
      continue;
    }
    if (isEmpty(raw)) continue;
    // Enum match is CASE-INSENSITIVE ("Protagonist" ≈ "protagonist") — a soft mismatch, not a hard fault.
    if (spec.options && typeof raw === "string" && !spec.options.some((o) => o.toLowerCase() === raw.toLowerCase())) {
      issues.push({ rule: "bad_enum", severity: "warn", message: `${kind}.${spec.key} = "${raw}" is not one of ${spec.options.join(" | ")}`, nodeId });
    }
    if ((spec.type === "list" || spec.type === "refs") && !Array.isArray(raw)) {
      issues.push({ rule: "bad_shape", severity: "warn", message: `${kind}.${spec.key} must be a list`, nodeId });
    }
    if ((spec.type === "number" || spec.type === "percent") && typeof raw !== "number") {
      issues.push({ rule: "bad_shape", severity: "warn", message: `${kind}.${spec.key} must be a number`, nodeId });
    }
  }
  return issues;
}

// ── Sanitize: coerce/strip SOFT issues so a node never dies over a capitalized enum or a comma-string list.
// Enum values are matched case-insensitively and rewritten to the canonical option; an enum value with no
// match is dropped (the node lands without it); a list field given a string is split on commas. Required
// fields and unknown keys are left untouched — only the recoverable shape problems are fixed. Pure.
export function sanitizeContent(kind: NodeKind, content: Record<string, unknown>): Record<string, unknown> {
  const walk = (specs: EditSpec[], obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...obj };
    for (const spec of specs) {
      const raw = out[spec.key];
      if (spec.type === "object" && raw && typeof raw === "object" && !Array.isArray(raw)) {
        out[spec.key] = walk(spec.fields ?? [], raw as Record<string, unknown>);
      } else if (spec.options && typeof raw === "string" && raw.trim()) {
        const canon = spec.options.find((o) => o.toLowerCase() === raw.trim().toLowerCase());
        if (canon) out[spec.key] = canon; else delete out[spec.key]; // unknown enum → drop, keep the node
      } else if ((spec.type === "list" || spec.type === "refs") && typeof raw === "string") {
        out[spec.key] = raw.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    return out;
  };
  return walk(editSpecs(kind), content ?? {});
}

/** Validate a node's content against its kind's schema. Pure, tree-independent — safe at the generation
 *  boundary (reject malformed AI output) and for the completeness score. `partial` treats the content as an
 *  edit PATCH (absent required fields are untouched, not missing). Unknown kinds (no schema) pass. */
export function validateContent(kind: NodeKind, content: Record<string, unknown>, opts: { nodeId?: string; partial?: boolean } = {}): DnaIssue[] {
  return checkSpecs(editSpecs(kind), content ?? {}, kind, opts.nodeId, opts.partial ?? false);
}

/** The required field keys for a kind (top-level only — the load-bearing minimum). Drives the score. */
export const requiredKeys = (kind: NodeKind): string[] => (NODE_SCHEMA[kind] ?? []).filter((s) => s.required).map((s) => s.key);

/** A node's content completeness in [0,1]: required fields filled ÷ required fields. Kinds with no required
 *  fields are trivially complete (1). The atom the DNA strength/completeness score sums over. */
export function contentCompleteness(node: DnaNode): number {
  const keys = requiredKeys(node.kind);
  if (!keys.length) return 1;
  const filled = keys.filter((k) => !isEmpty((node.content as Record<string, unknown>)[k])).length;
  return filled / keys.length;
}

/** Whether a node carries every required field (used to gate "accept" and to detect placeholder nodes). */
export const isContentComplete = (node: DnaNode): boolean => validateContent(node.kind, node.content as Record<string, unknown>, { nodeId: node.id }).every((i) => i.rule !== "missing_field");

export const VALID_KINDS = new Set<string>(Object.keys(KIND_LEVEL));

// ── The generation artifact (what the prompt + the edge/bridge consume) ──────────────────────────────────
// One renderer turns NODE_SCHEMA into (a) a human prompt block the model reads and (b) machine `kinds` data
// for validation. This is emitted to supabase/functions/_shared/dna-schema.json (a checked artifact kept in
// sync by a golden test); the dna-chat EDGE fn and the dev BRIDGE both inject `promptGuide` verbatim instead
// of hand-maintaining their own (drift-prone) copy. SSOT: NODE_SCHEMA → artifact → edge + bridge.
function renderField(spec: EditSpec): string {
  const star = spec.required ? "*" : "";
  if (spec.genOnly) return `${spec.key}${star}${spec.note ? ` ${spec.note}` : ""}`;
  switch (spec.type) {
    case "object": return `${spec.key}${star}:{ ${(spec.fields ?? []).map(renderField).join(", ")} }`;
    case "select": return `${spec.key}${star}(${(spec.options ?? []).join("|")})`;
    case "ref": return `${spec.key}${star}→${spec.refKind}`;
    case "refs": return `${spec.key}${star}[]→${spec.refKind}`;
    case "list": return `${spec.key}${star}[]`;
    case "percent": return `${spec.key}${star}(0..1)`;
    case "number": return `${spec.key}${star}(num)`;
    default: return `${spec.key}${star}`;
  }
}

export interface KindSchemaInfo { required: string[]; enums: Record<string, string[]>; refs: Record<string, string>; fields: string[] }
export interface DnaSchemaArtifact { promptGuide: string; kinds: Record<string, KindSchemaInfo> }

export function dnaSchemaArtifact(): DnaSchemaArtifact {
  const order = Object.keys(NODE_SCHEMA) as NodeKind[];
  const header = "CONTENT FIELD SCHEMAS — use EXACTLY these keys. * = required · (a|b) = allowed values · →kind = an id of that kind · [] = a list. Wrong keys silently orphan data.";
  const promptGuide = [header, ...order.map((k) => `- ${k} → ${(NODE_SCHEMA[k] ?? []).map(renderField).join(", ")}`)].join("\n");

  const kinds: Record<string, KindSchemaInfo> = {};
  for (const k of order) {
    const specs = editSpecs(k); // validation-relevant (no genOnly)
    const enums: Record<string, string[]> = {}, refs: Record<string, string> = {};
    for (const s of specs) {
      if (s.options) enums[s.key] = s.options;
      if ((s.type === "ref" || s.type === "refs") && s.refKind) refs[s.key] = s.refKind;
    }
    kinds[k] = { required: specs.filter((s) => s.required).map((s) => s.key), enums, refs, fields: specs.map((s) => s.key) };
  }
  return { promptGuide, kinds };
}
