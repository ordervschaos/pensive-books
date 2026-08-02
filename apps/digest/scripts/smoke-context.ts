/**
 * The context policy, tested without a model.
 *
 *   cd apps/digest && npx tsx scripts/smoke-context.ts
 *
 * The claim being checked is the one that matters: **a long conversation costs what a short one costs.**
 * That is measurable in characters, deterministically, with no API key and no spend — so it is checked here
 * rather than inferred from a bill later.
 *
 * Also checked: the invariant that would make every one of those cheap prompts a 400. A tool result whose
 * call is missing (or a call whose result is missing) is a malformed conversation and providers reject it,
 * so calls and results must be dropped together or not at all.
 */
import { WINDOW, buildContext, exchanges, stalenessNote } from "../lib/digest/agent/context";
import type { Turn } from "../lib/digest/llm";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** One exchange: the reader asks, the agent makes a fat tool call, the agent answers. */
function exchange(n: number): Turn[] {
  return [
    { role: "user", content: `Question number ${n} about my digest, of ordinary length.` },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: `call_${n}`, name: "read_posts", input: { limit: 30 } }],
    },
    // A real read_posts result. This is where the tokens actually are.
    { role: "tool", toolCallId: `call_${n}`, content: "unused · f_phil · Daily Stoic · 3.2y old · Some headline\n".repeat(30) },
    { role: "assistant", content: `Answer number ${n}, a couple of sentences of plain prose about what I found.` },
  ];
}

function transcript(n: number): Turn[] {
  return Array.from({ length: n }, (_, i) => exchange(i + 1)).flat();
}

/** Simulate the loop's fold cycle over a growing transcript: whenever a fold is due, it happens. */
function grow(turns: number): { sent: Turn[]; kept: Turn[]; folds: number } {
  let fold: string | null = null;
  let foldedThrough = 0;
  let folds = 0;
  let built = buildContext({ messages: [], fold, foldedThrough });

  for (let n = 1; n <= turns; n += 1) {
    const messages = transcript(n);
    built = buildContext({ messages, fold, foldedThrough });
    if (built.foldThrough !== null) {
      folds += 1;
      // A real fold is capped at 120 words; stand in with something that size.
      fold = "- prefers plain, unhurried writing; dislikes hype\n- turned down a search section: too expensive\n".repeat(2);
      foldedThrough = built.foldThrough;
      built = buildContext({ messages, fold, foldedThrough });
    }
  }
  return { sent: built.messages, kept: transcript(turns), folds };
}

function size(messages: Turn[]): number {
  return JSON.stringify(messages).length;
}

console.log("\n1. Growth");
const at5 = grow(5);
const at40 = grow(40);
const at120 = grow(120);
const kept40 = size(at40.kept);

console.log(`  turn   5: sent ${size(at5.sent)} chars`);
console.log(`  turn  40: sent ${size(at40.sent)} chars   (whole transcript would be ${kept40})`);
console.log(`  turn 120: sent ${size(at120.sent)} chars`);

check(
  "turn 40 is within 25% of turn 5",
  Math.abs(size(at40.sent) - size(at5.sent)) / size(at5.sent) < 0.25,
);
check("turn 120 is no bigger than turn 40", size(at120.sent) <= size(at40.sent) * 1.05);
check(`turn 40 sends under a tenth of the transcript`, size(at40.sent) < kept40 / 10, `${Math.round((size(at40.sent) / kept40) * 100)}%`);
check("nothing was lost from what is KEPT", at40.kept.length === 160, `${at40.kept.length} messages`);
check("the fold ran, and rarely", at40.folds > 0 && at40.folds < 40, `${at40.folds} folds over 40 turns`);

console.log("\n2. Well-formedness (a violation here is a 400 from the provider, every turn)");
for (const [label, built] of [["turn 5", at5], ["turn 40", at40], ["turn 120", at120]] as const) {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const turn of built.sent) {
    if (turn.role === "assistant") for (const c of turn.toolCalls ?? []) calls.add(c.id);
    if (turn.role === "tool") results.add(turn.toolCallId);
  }
  const orphanResults = [...results].filter((id) => !calls.has(id));
  const danglingCalls = [...calls].filter((id) => !results.has(id));
  check(`${label}: no orphan tool results`, orphanResults.length === 0, orphanResults.join(","));
  check(`${label}: no dangling tool calls`, danglingCalls.length === 0, danglingCalls.join(","));
}

console.log("\n3. What survives, and what doesn't");
const recent = at40.sent.filter((t) => t.role === "tool");
check(`only the window's tool results are sent (${recent.length} ≤ ${WINDOW})`, recent.length <= WINDOW);
check(
  "those are truncated, not verbatim",
  recent.every((t) => t.role === "tool" && t.content.includes("truncated")),
);
check(
  "the fold is carried",
  at40.sent.some((t) => t.role === "user" && t.content.includes("earlier_in_this_conversation")),
);
check("the newest question is verbatim", at40.sent.some((t) => t.role === "user" && t.content.includes("number 40")));
check(
  "an old question is gone from what is SENT",
  !at40.sent.some((t) => t.role === "user" && t.content.includes("number 1 ")),
);

console.log("\n4. Exchange splitting");
check("40 exchanges found", exchanges(transcript(40)).length === 40);
check("an empty transcript has none", exchanges([]).length === 0);

console.log("\n5. Staleness fence");
check("silent on a new conversation", stalenessNote(null, 7) === null);
check("silent when nothing moved", stalenessNote(7, 7) === null);
check("speaks when somebody else wrote", (stalenessNote(7, 9) ?? "").includes("edited elsewhere"));

console.log(`\n${failures === 0 ? "ALL OK" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
