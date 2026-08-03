// Locks the invariants that make fold-on-read safe (doc_1785773301000.md). Two of them are the kind
// that fail SILENTLY — a broken watchdog looks exactly like a well-behaved run until a build hangs.
//
// --no-check because transcript.ts pulls VERIFY_SENTINEL from verify.ts, whose transitive imports
// reference the edge runtime's ambient EdgeRuntime global (pre-existing, unrelated to what's asserted here).
//   deno test --no-check supabase/functions/book-agent/transcript.test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import type { AgentStep } from "./shared.ts";
import { FORCE_COMMIT_AFTER_READS, RECORD_FINDINGS_AFTER_READS, findingsBlock, trailingReadRun, unrecordedReadRun } from "./transcript.ts";

const read = (n: number): AgentStep[] => Array.from({ length: n }, (_, i) => ({ t: "read", label: `read ${i}` } as AgentStep));
const finding = (...pairs: [string, string][]): AgentStep => ({ t: "finding", label: "noted", findings: pairs.map(([ref, f]) => ({ ref, finding: f })) });

Deno.test("recording findings does NOT disarm the force-commit watchdog", () => {
  // The whole point of the backstop is that a run which keeps reading eventually MUST commit. If a
  // 'finding' step reset trailingReadRun, a run could read→record→read→record forever and the watchdog
  // would never fire — trading the old gather-forever loop for a new one that merely looks productive.
  const steps = [...read(8), finding(["scene 1", "no metaphor"]), ...read(7)];
  assertEquals(trailingReadRun(steps), 15);
  assertEquals(trailingReadRun(steps) >= FORCE_COMMIT_AFTER_READS, true);
});

Deno.test("a commit DOES reset the watchdog", () => {
  assertEquals(trailingReadRun([...read(9), { t: "plan", label: "fixed it" }, ...read(2)]), 2);
});

Deno.test("the record nudge fires on its own counter, which findings DO reset", () => {
  assertEquals(unrecordedReadRun(read(RECORD_FINDINGS_AFTER_READS)), RECORD_FINDINGS_AFTER_READS);
  // Everything before a 'finding' is already distilled, so only the reads after it are unbanked.
  assertEquals(unrecordedReadRun([...read(9), finding(["scene 1", "x"]), ...read(2)]), 2);
});

Deno.test("the nudge threshold sits below the watchdog's, so it always gets a chance to fire first", () => {
  assertEquals(RECORD_FINDINGS_AFTER_READS < FORCE_COMMIT_AFTER_READS, true);
});

Deno.test("narration resets neither counter", () => {
  const steps = [...read(3), { t: "note", label: "let me look at act 2" } as AgentStep, ...read(3)];
  assertEquals(trailingReadRun(steps), 6);
  assertEquals(unrecordedReadRun(steps), 6);
});

Deno.test("an unused ledger costs zero prompt bytes", () => {
  assertEquals(findingsBlock([]), "");
  assertEquals(findingsBlock(read(5)), "");
  // A malformed/empty call must not emit an empty block either.
  assertEquals(findingsBlock([{ t: "finding", label: "noted", findings: [{ ref: "x", finding: "  " }] }]), "");
});

Deno.test("the ledger renders every recorded finding, oldest first", () => {
  const block = findingsBlock([
    finding(["scene 1", "opens mid-dialogue"], ["scene 2", "clean"]),
    ...read(3),
    finding(["scene 9", "metaphor monotone"]),
  ]);
  assertStringIncludes(block, "<findings");
  assertStringIncludes(block, "scene 1 — opens mid-dialogue");
  assertStringIncludes(block, "scene 2 — clean");
  assertStringIncludes(block, "scene 9 — metaphor monotone");
  assertEquals(block.indexOf("scene 1") < block.indexOf("scene 9"), true);
});

Deno.test("the ledger is capped, keeping the NEWEST findings", () => {
  // A long run must not turn the cure into the disease: the ledger rides uncached every turn.
  const many = Array.from({ length: 80 }, (_, i) => finding([`scene ${i}`, `finding ${i}`]));
  const block = findingsBlock(many);
  assertStringIncludes(block, "finding 79");
  assertEquals(block.includes("finding 0\n") || block.includes("finding 0<"), false);
  assertStringIncludes(block, "20 older findings dropped");
});
