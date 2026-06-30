import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { dnaSchemaArtifact } from "@/lib/dnaSchema";

// The committed artifact the dna-chat EDGE fn + the dev BRIDGE read. This test is the lock that keeps it in
// sync with NODE_SCHEMA: edit the schema, run `UPDATE_DNA_SCHEMA=1 npx vitest run dnaSchema.artifact` to
// regenerate, commit the JSON. If they drift, this fails — so the prompt can never silently go stale again.
const ARTIFACT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../supabase/functions/_shared/dna-schema.json");

describe("dna-schema artifact (edge/bridge ↔ NODE_SCHEMA)", () => {
  it("matches the committed supabase/functions/_shared/dna-schema.json", () => {
    const current = JSON.stringify(dnaSchemaArtifact(), null, 2) + "\n";
    if (process.env.UPDATE_DNA_SCHEMA) { writeFileSync(ARTIFACT_PATH, current); return; }
    const committed = readFileSync(ARTIFACT_PATH, "utf8");
    expect(current, "dna-schema.json is stale — run `UPDATE_DNA_SCHEMA=1 npx vitest run dnaSchema.artifact` and commit").toBe(committed);
  });

  it("the prompt guide uses the real keys, not the drifted ones", () => {
    const { promptGuide } = dnaSchemaArtifact();
    expect(promptGuide).toContain("relationship → a*→character, b*→character, bond*"); // not dynamic/arc
    expect(promptGuide).toContain("tentpole → summary*");                              // not title/when
    expect(promptGuide).toContain("value_shift");                                      // scene, not "value"
    expect(promptGuide).toContain("connector(therefore|but)");
    expect(promptGuide).not.toContain("dynamic"); // the old relationship drift
  });
});
