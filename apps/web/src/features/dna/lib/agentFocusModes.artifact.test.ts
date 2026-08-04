import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// The edge is the SOURCE OF TRUTH for the focus registry (agent-focus.ts — it also owns the done()
// predicates and the prompt block, neither of which can cross the deploy boundary). The rail needs the
// PRESENTATIONAL half (key/label/blurb/target arity) at runtime to render the mode picker, so it reads a
// committed JSON MIRROR. This test is the lock that keeps the mirror honest — same pattern as
// craftNotes.artifact.test / dnaSchema.artifact.test:
//   edit FOCUS_MODES, run `UPDATE_FOCUS_MODES=1 npx vitest run agentFocusModes.artifact`, commit the JSON.
import { FOCUS_MODES } from "../../../../../../supabase/functions/_shared/agent-focus.ts";

const MIRROR_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "./agentFocusModes.json");

// Only the display fields cross over. `skills`/`done`/`exitHint` stay server-side: they're prompt
// policy, and mirroring them would invite the client to start enforcing them (the fence the invariants
// in agent-focus.ts exist to prevent).
const display = FOCUS_MODES.map((m) => ({ key: m.key, label: m.label, blurb: m.blurb, target: m.target }));

describe("agentFocusModes.json mirror (rail picker ↔ edge FOCUS_MODES)", () => {
  it("matches the committed agentFocusModes.json", () => {
    const current = JSON.stringify(display, null, 2) + "\n";
    if (process.env.UPDATE_FOCUS_MODES) { writeFileSync(MIRROR_PATH, current); return; }
    const committed = readFileSync(MIRROR_PATH, "utf8");
    expect(committed, "agentFocusModes.json is stale — run `UPDATE_FOCUS_MODES=1 npx vitest run agentFocusModes.artifact` and commit").toBe(current);
  });

  it("keeps `wide` first — it is the identity element and the picker's default row", () => {
    expect(display[0].key).toBe("wide");
  });
});
