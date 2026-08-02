// Locks the ONE property that makes the A/B seam safe to ship: an unset variant is a no-op, so production
// prompt bytes are identical to having no seam at all. An eval hook that quietly alters what real authors
// get is worse than no eval hook.
//
//   deno test supabase/functions/book-agent/variants.test.ts
import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { VARIANTS, variantSuffix } from "./variants.ts";

Deno.test("unset variant is a no-op", () => {
  assertEquals(variantSuffix(null), "");
  assertEquals(variantSuffix(undefined), "");
  assertEquals(variantSuffix(""), "");
});

Deno.test("unknown variant is a no-op rather than an error", () => {
  // A typo in an eval script must not fail a real author's turn. The symptom is visible anyway: both arms
  // behave identically, which reads as "no effect" in the report.
  assertEquals(variantSuffix("not_a_real_variant"), "");
});

Deno.test("a known variant contributes a non-empty suffix", () => {
  for (const [name, v] of Object.entries(VARIANTS)) {
    assertNotEquals(variantSuffix(name), "", `${name} must change something`);
    assertEquals(variantSuffix(name), v.suffix);
    assertNotEquals(v.what.trim(), "", `${name} must document what it tests`);
  }
});
