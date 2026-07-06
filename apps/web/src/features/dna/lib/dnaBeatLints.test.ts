import { describe, expect, it } from "vitest";
import { canonicalizeKey, validate, type DnaNode, type NodeKind } from "@/features/dna/lib/novelDna";

// Locks the rule-selection behind dna-expand's P2.1 beat lint-then-repair (BEAT_LINT_RULES). The beatsheet is
// linted on a BEATS-ONLY tree (no scenes exist yet), so this asserts which validate() rules are decidable
// there — the ones dna-expand repairs — and which are scene-oriented and would false-positive / stay silent
// (deliberately EXCLUDED from the repair allowlist). If validate() changes so a scene rule fires on beats,
// this fails and dna-expand's allowlist should be revisited.
let seq = 0;
const mk = (kind: NodeKind, over: Partial<DnaNode> & { content?: Record<string, unknown> } = {}): DnaNode => ({
  id: over.id ?? `n_${kind}_${seq++}`, book_id: 1, parent_id: over.parent_id ?? null, level: over.level ?? 0, kind,
  position: over.position ?? 0, content: over.content ?? {},
  authoring: { source: "user", locked: false, status: "accepted", ...(over.authoring ?? {}) },
});

const BEAT_LINT_RULES = new Set(["uncaused_therefore", "empty_but", "beat_connector", "illegal_resolution", "unresolved_game"]);

// A beats-only tree (mirrors beatsheet time): pillar → act → beats, plus an accepted tentpole never placed and
// a game that's played but never resolved. b2 is a hollow "therefore" (needs a key no earlier beat establishes).
function beatsOnlyTree(): DnaNode[] {
  const pillar = mk("pillar", { id: "pil" });
  const game = mk("game", { id: "gm", parent_id: "pil", content: { name: "the wager", win_condition: "win", lose_condition: "lose" } });
  const tent = mk("tentpole", { id: "tp", parent_id: "pil", content: { summary: "the reveal" } });
  const act = mk("act", { id: "a1", parent_id: "pil", position: 0, content: { title: "One" } });
  const b1 = mk("beat", { id: "b1", parent_id: "a1", position: 0, content: { summary: "Opening.", polarity: "up", establishes: ["door_open"], plays: ["gm"] } });
  const b2 = mk("beat", { id: "b2", parent_id: "a1", position: 1, content: { summary: "Hollow turn.", connector: "therefore", polarity: "up", needs: ["never_established"] } });
  return [pillar, game, tent, act, b1, b2];
}

describe("beat-stage lints (dna-expand P2.1 allowlist)", () => {
  const rules = new Set(validate(beatsOnlyTree()).map((i) => i.rule));

  it("fires the beat-native causality lint (uncaused_therefore) — a repair target", () => {
    expect(rules.has("uncaused_therefore")).toBe(true);
  });

  it("fires unresolved_game when a played game never resolves — a repair target", () => {
    expect(rules.has("unresolved_game")).toBe(true);
  });

  it("tentpole_unplaced fires on a beats-only tree — proving it's a beat-stage FALSE POSITIVE (excluded)", () => {
    // Placement at beat stage is via beat.realizes, but the lint only checks scenes' realizes_tentpole, so it
    // flags every accepted tentpole before scenes exist. Excluding it from the repair allowlist is correct.
    expect(rules.has("tentpole_unplaced")).toBe(true);
    expect(BEAT_LINT_RULES.has("tentpole_unplaced")).toBe(false);
  });

  it("every actionable rule the repair prompt targets is in the engine's rule vocabulary or benignly absent", () => {
    // Sanity: the allowlist names real rules — at least the two we deliberately provoked are present.
    const provoked = [...rules].filter((r) => BEAT_LINT_RULES.has(r));
    expect(provoked).toEqual(expect.arrayContaining(["uncaused_therefore", "unresolved_game"]));
  });
});

describe("canonicalizeKey — state-key DAG-split fix (§3c)", () => {
  it("snaps a plural/typo split onto the established spelling", () => {
    const known = ["redemption_fund", "rival_humiliated"];
    expect(canonicalizeKey("redemption_funds", known)).toBe("redemption_fund"); // plural (distance 1)
    expect(canonicalizeKey("redemtion_fund", known)).toBe("redemption_fund");   // typo (distance 1)
  });

  it("leaves an exact match and a genuinely distinct key untouched", () => {
    const known = ["redemption_fund", "door_open"];
    expect(canonicalizeKey("redemption_fund", known)).toBe("redemption_fund"); // exact
    expect(canonicalizeKey("ledger_settled", known)).toBe("ledger_settled");   // far from anything → unchanged
  });

  it("never merges short keys or whole-word-different keys (conservative thresholds)", () => {
    expect(canonicalizeKey("won", ["win"])).toBe("won");                         // min length < 6 → no merge
    expect(canonicalizeKey("guard_bribed", ["guard_tricked"])).toBe("guard_bribed"); // distance > 2 → no merge
  });

  it("first-seen spelling wins when folding a set (mirrors the beatsheet pass)", () => {
    const canon = new Set<string>();
    const fold = (k: string) => { const c = canonicalizeKey(k, canon); canon.add(c); return c; };
    expect(["redemption_fund", "redemption_funds", "redemption_fund"].map(fold))
      .toEqual(["redemption_fund", "redemption_fund", "redemption_fund"]);
    expect([...canon]).toEqual(["redemption_fund"]); // both spellings collapsed to one canonical key
  });
});
