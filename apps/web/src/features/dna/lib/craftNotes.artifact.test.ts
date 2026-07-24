import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// The edge is the SOURCE OF TRUTH for the default craft text (craft-kb.ts, imported by dna-expand + the
// judges). The web Craft Notes tab needs those same defaults at RUNTIME to show/edit them, but it can't
// import an edge module across the deploy boundary — so it reads a committed JSON MIRROR. This test is the
// lock that keeps the mirror honest, exactly like dnaSchema.artifact.test does for dna-schema.json:
// edit CRAFT_NOTES, run `UPDATE_CRAFT_NOTES=1 npx vitest run craftNotes.artifact` and commit the JSON.
// craft-kb.ts is pure strings (no Deno/jsr imports), so vitest loads it directly.
import { CRAFT_NOTES } from "../../../../../../supabase/functions/_shared/craft-kb.ts";

const MIRROR_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "./craftNotes.json");

describe("craftNotes.json mirror (web tab ↔ edge CRAFT_NOTES)", () => {
  it("matches the committed craftNotes.json", () => {
    const current = JSON.stringify(CRAFT_NOTES, null, 2) + "\n";
    if (process.env.UPDATE_CRAFT_NOTES) { writeFileSync(MIRROR_PATH, current); return; }
    const committed = readFileSync(MIRROR_PATH, "utf8");
    expect(committed, "craftNotes.json is stale — run `UPDATE_CRAFT_NOTES=1 npx vitest run craftNotes.artifact` and commit").toBe(current);
  });
});
