import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { AGENT_SKILLS } from "./agent-skills.ts";
import { FOCUS_MODES, focusBlock, focusSkills, getFocusMode, resolveFocus, suggestedMode } from "./agent-focus.ts";
import type { Brief } from "./brief.ts";
import type { DnaNode } from "./novel-dna.ts";

// docs/agent-focus.md — the declared focus. The tests that matter most here are the two INVARIANT locks
// (degradation to byte-identical behaviour, and the anchor-not-fence framing), not the happy path.

// deno-lint-ignore no-explicit-any
const node = (id: string, kind: string, content: Record<string, unknown> = {}, status = "accepted"): DnaNode => ({
  id, book_id: 1, parent_id: null, level: 0, kind, position: 0, content,
  authoring: { source: "ai", locked: false, status },
} as any);

const brief = (v?: Brief["vision"]): Brief => ({ vision: v } as Brief);

// ── The degradation lock (docs/agent-focus.md §2) ────────────────────────────────────────────────────
// `wide` is the identity element: an undeclared turn must assemble a byte-identical prompt to
// pre-focus behaviour. If this breaks, every existing chat silently changes.

Deno.test("no stored focus → undeclared wide, empty block, no skills (byte-identical prompt)", () => {
  const r = resolveFocus(null, [], null);
  assertEquals(r.mode.key, "wide");
  assertEquals(r.declared, false);
  assertEquals(focusBlock(r), "");
  assertEquals(focusSkills(r), []);
});

Deno.test("explicitly stored 'wide' is still the identity element", () => {
  const r = resolveFocus({ mode: "wide", target: "n_1", at: null }, [node("n_1", "scene")], null);
  assertEquals(r.declared, false);
  assertEquals(r.target, null);
  assertEquals(focusBlock(r), "");
});

Deno.test("an unrecognised mode key degrades to wide instead of throwing", () => {
  // A rolled-back mode or a hand-edited row must never brick the agent.
  const r = resolveFocus({ mode: "not-a-real-mode", target: null, at: null }, [], null);
  assertEquals(r.mode.key, "wide");
  assertEquals(r.declared, false);
  assertEquals(focusBlock(r), "");
});

// ── The anchor-not-fence lock (docs/agent-focus.md §2) ───────────────────────────────────────────────
// A declared focus is STICKIER than a derived objective, so the block must always carry both the
// ask-wins clause and the explicit statement that nothing is actually restricted.

Deno.test("every declared focus block says the ask wins and nothing is fenced", () => {
  const nodes = [node("n_s", "scene", { prose: { text: "" } })];
  for (const m of FOCUS_MODES.filter((x) => x.key !== "wide")) {
    const r = resolveFocus({ mode: m.key, target: "n_s", at: null }, nodes, null);
    const block = focusBlock(r);
    assertStringIncludes(block, "concrete ask ALWAYS wins");
    assertStringIncludes(block, "whole book is still visible");
    assertStringIncludes(block, "still editable");
  }
});

// ── Target resolution ────────────────────────────────────────────────────────────────────────────────

Deno.test("a declared mode with a live target carries it into the block", () => {
  const nodes = [node("n_s", "scene")];
  const r = resolveFocus({ mode: "draft-scene", target: "n_s", at: null }, nodes, null);
  assertEquals(r.declared, true);
  assertEquals(r.target, "n_s");
  assertEquals(r.targetMissing, false);
  assertStringIncludes(focusBlock(r, "The auction"), "[n_s]");
  assertStringIncludes(focusBlock(r, "The auction"), "The auction");
});

Deno.test("a deleted target degrades to no target and says so — never an error", () => {
  const r = resolveFocus({ mode: "draft-scene", target: "n_gone", at: null }, [node("n_s", "scene")], null);
  assertEquals(r.target, null);
  assertEquals(r.targetMissing, true);
  assertStringIncludes(focusBlock(r), "no longer exists");
});

Deno.test("a 'none'-arity mode ignores any target it is handed", () => {
  const r = resolveFocus({ mode: "interview", target: "n_s", at: null }, [node("n_s", "scene")], null);
  assertEquals(r.target, null);
  assertEquals(r.targetMissing, false); // it was never wanted, so it isn't "missing"
});

// ── Completion predicates — the self-clearing behaviour (docs/agent-focus.md §6) ─────────────────────

Deno.test("interview completes when the vision is compiled", () => {
  const stored = { mode: "interview", target: null, at: null };
  assertEquals(resolveFocus(stored, [], brief({})).completed, false);
  assertEquals(resolveFocus(stored, [], brief({ compiled_at: "2026-08-03" })).completed, true);
});

Deno.test("draft-scene completes when the target scene has prose", () => {
  const stored = { mode: "draft-scene", target: "n_s", at: null };
  const empty = [node("n_s", "scene", { prose: { text: "  " } })];
  const drafted = [node("n_s", "scene", { prose: { text: "The auction opened at dusk." } })];
  assertEquals(resolveFocus(stored, empty, null).completed, false);
  assertEquals(resolveFocus(stored, drafted, null).completed, true);
});

Deno.test("logline completes only on an ACCEPTED seed that has a logline", () => {
  const stored = { mode: "logline", target: null, at: null };
  assertEquals(resolveFocus(stored, [node("n_seed", "seed", {}, "accepted")], null).completed, false);
  assertEquals(resolveFocus(stored, [node("n_seed", "seed", { logline: "A girl steals a map." }, "draft")], null).completed, false);
  assertEquals(resolveFocus(stored, [node("n_seed", "seed", { logline: "A girl steals a map." }, "accepted")], null).completed, true);
});

Deno.test("a required-target mode with no target never completes and never throws", () => {
  for (const m of FOCUS_MODES.filter((x) => x.target === "required" && x.done)) {
    assertEquals(resolveFocus({ mode: m.key, target: null, at: null }, [], null).completed, false);
  }
});

// ── Suggestion ladder (derived proposes, author disposes) ────────────────────────────────────────────

Deno.test("suggestedMode walks the journey ladder", () => {
  assertEquals(suggestedMode([], null), "interview");
  assertEquals(suggestedMode([], brief({ compiled_at: "x" })), "logline");
  const withSeed = [node("n_seed", "seed", { logline: "A girl steals a map." }, "accepted")];
  assertEquals(suggestedMode(withSeed, brief({ compiled_at: "x" })), "foundations");
});

// ── Registry integrity ───────────────────────────────────────────────────────────────────────────────

Deno.test("every mode's skills name a real playbook (no drift with agent-skills.ts)", () => {
  const known = new Set(AGENT_SKILLS.map((s) => s.name));
  for (const m of FOCUS_MODES) {
    for (const s of m.skills) {
      assert(known.has(s), `focus mode "${m.key}" references unknown skill "${s}"`);
    }
  }
});

Deno.test("every non-wide mode has an exit hint (a narrowing must announce its way out)", () => {
  for (const m of FOCUS_MODES.filter((x) => x.key !== "wide")) {
    assert(m.exitHint.trim().length > 0, `mode "${m.key}" has no exitHint`);
  }
});

Deno.test("mode keys are unique and getFocusMode round-trips them", () => {
  const keys = FOCUS_MODES.map((m) => m.key);
  assertEquals(new Set(keys).size, keys.length);
  for (const k of keys) assertEquals(getFocusMode(k).key, k);
  assertEquals(getFocusMode(null).key, "wide");
});
