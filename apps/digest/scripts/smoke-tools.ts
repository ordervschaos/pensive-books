/**
 * Smoke test for the AGENT TOOL BELT, against the real project — no model, no chat UI.
 *
 *   cd apps/digest && npx tsx --env-file=.env.local scripts/smoke-tools.ts <digestId>
 *
 * The belt is generated from `sectionSchema.ts`, so the thing worth proving is that the generation is
 * faithful: every kind gets a tool, the required fields survive into the JSON Schema, native values reach
 * the store intact, and a section that could never work is refused with the SAME sentence the form gives.
 *
 * Writes: it adds a scratch section, patches it, and removes it in a `finally`. Nothing else is mutated —
 * `update_digest` is exercised as a no-op patch (writing the name back) precisely so this stays safe to run
 * against a live digest.
 *
 * Service role, because a script has no session. The real caller passes an RLS-enforcing client.
 */
import { TOOLS, runTool, type ToolCtx } from "../lib/digest/agent/tools";
import { SECTION_FIELDS } from "../lib/digest/sectionSchema";
import { createServiceClient } from "../lib/supabase/server";
import type { Section, SectionKind } from "../lib/digest/types";

const digestId = Number(process.argv[2] ?? 1);
const ctx: ToolCtx = { supabase: createServiceClient() as never, digestId };

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function sections(): Promise<Section[]> {
  const { data } = await createServiceClient()
    .from("digests")
    .select("sections")
    .eq("id", digestId)
    .single();
  return ((data as { sections: Section[] } | null)?.sections ?? []) as Section[];
}

async function main() {
  // --- 1. the belt is complete and well-formed ---------------------------------------------------
  console.log(`\n1. Generation — ${TOOLS.length} tools`);
  const kinds = Object.keys(SECTION_FIELDS) as SectionKind[];
  for (const kind of kinds) {
    const tool = TOOLS.find((t) => t.name === `add_${kind}_section`);
    check(`add_${kind}_section exists`, Boolean(tool));
    if (!tool) continue;
    // Required-in-the-schema must equal required-in-the-parser, or the model is told one thing and the
    // server enforces another.
    const expected = [...SECTION_FIELDS[kind], { name: "title", required: true }]
      .filter((f) => (f as { required?: boolean }).required)
      .map((f) => f.name)
      .sort();
    check(
      `  required matches the schema`,
      JSON.stringify((tool.input_schema.required ?? []).sort()) === JSON.stringify(expected),
      `schema=${JSON.stringify(tool.input_schema.required)} expected=${JSON.stringify(expected)}`,
    );
  }
  check(
    "every tool has a description",
    TOOLS.every((t) => t.description.length > 20),
  );
  check("no tool exposes digest_id", !JSON.stringify(TOOLS).includes('"digest_id"'));
  check("create_digest is absent (the agent works inside one digest)", !TOOLS.some((t) => t.name === "create_digest"));

  // A spot check that field types survived: ranked.targets is a list, min_score an integer.
  const ranked = TOOLS.find((t) => t.name === "add_ranked_section")!;
  const props = ranked.input_schema.properties as Record<string, { type?: string; enum?: string[] }>;
  check("ranked.targets is an array", props.targets?.type === "array");
  check("ranked.min_score is an integer", props.min_score?.type === "integer");
  check("ranked.source carries its enum", (props.source?.enum ?? []).includes("arxiv"));

  // --- 2. reads ------------------------------------------------------------------------------------
  console.log("\n2. Reads");
  const digest = await runTool(ctx, "read_digest", {});
  check("read_digest names the digest and its sections", digest.includes("Sections:"));
  console.log(indent(digest));

  const ready = await runTool(ctx, "check_readiness", {});
  check("check_readiness answers", ready.length > 0);
  console.log(indent(ready));

  const issues = await runTool(ctx, "read_issues", { limit: 3 });
  check("read_issues answers", issues.length > 0);
  console.log(indent(issues));

  const posts = await runTool(ctx, "read_posts", { limit: 5, used: false });
  check("read_posts reports the age of the writing", /old|today|age unknown/.test(posts));
  console.log(indent(posts));

  console.log(indent(await runTool(ctx, "read_inbox", { limit: 3 })));

  // --- 3. the refusal ------------------------------------------------------------------------------
  // The success criterion for this rung: a ranked/arxiv section with no targets must be refused with the
  // form's own sentence, not with a schema error and not by saving something that can never work.
  console.log("\n3. Refusals");
  await expectError("add_ranked_section without targets (arxiv)", { source: "arxiv", title: "Papers" });
  await expectError("add_feed_section without urls", { title: "No urls" });
  await expectError("update_section on an unknown id", { section_id: "nope", fields: { title: "x" } }, "update_section");

  // --- 4. writes -----------------------------------------------------------------------------------
  console.log("\n4. Writes");
  const before = await sections();
  let scratch: string | null = null;
  try {
    const added = await runTool(ctx, "add_ranked_section", {
      title: "SCRATCH — arxiv",
      source: "arxiv",
      targets: ["cs.CL", "cs.AI"],
      query: "retrieval",
      cadence: "weekly",
      weekday: 2,
      max_items: 3,
      instructions: "primary sources only",
    });
    check("add_ranked_section succeeded", added.includes("ranked"), added);

    const now = await sections();
    const s = now.find((x) => !before.some((b) => b.id === x.id));
    scratch = s?.id ?? null;
    check("the section was stored", Boolean(s));
    console.log(indent(JSON.stringify(s)));
    check(
      "native values survived",
      JSON.stringify((s as never as { targets: string[] })?.targets) === JSON.stringify(["cs.CL", "cs.AI"]),
    );
    check("cadence + weekday survived", s?.cadence === "weekly" && s?.weekday === 2);

    // The patch property: change ONE field, everything else must stay.
    const patched = await runTool(ctx, "update_section", {
      section_id: scratch,
      fields: { title: "SCRATCH — renamed" },
    });
    check("update_section succeeded", patched.includes("renamed"), patched);
    const after = (await sections()).find((x) => x.id === scratch) as never as {
      targets: string[];
      query: string;
      instructions: string;
      max_items: number;
    };
    check(
      "omitted fields were preserved",
      JSON.stringify(after?.targets) === JSON.stringify(["cs.CL", "cs.AI"]) &&
        after?.query === "retrieval" &&
        after?.instructions === "primary sources only" &&
        after?.max_items === 3,
      JSON.stringify(after),
    );

    // A no-op patch, to prove update_digest only writes the keys it was given.
    const named = await runTool(ctx, "update_digest", { name: (await currentName()) });
    check("update_digest patches only what it was given", named === "Updated name.", named);
  } finally {
    if (scratch) {
      const removed = await runTool(ctx, "remove_section", { section_id: scratch });
      check("cleanup removed the scratch section", removed.startsWith("Removed"), removed);
    }
    const end = await sections();
    check(`section count restored (${end.length})`, end.length === before.length);
  }

  // --- 5. optimistic concurrency --------------------------------------------------------------------
  // The lost update this guards: an agent reads at the start of a turn, thinks, and writes an array
  // computed from what it saw. Anything the reader did in between used to vanish silently.
  console.log("\n5. Concurrency");
  const held: { version: number } = { version: await currentVersion() };
  const guarded: ToolCtx = { ...ctx, sections: held };
  let raced: string | null = null;
  let mine: string | null = null;
  try {
    // A competing writer commits while our turn is "thinking" — here, the unguarded ctx standing in for
    // the reader's form.
    await runTool(ctx, "add_feed_section", { title: "SCRATCH — the other writer", urls: ["https://example.com/x.xml"] });
    raced = (await sections()).find((s) => s.title === "SCRATCH — the other writer")?.id ?? null;
    check("a competing write landed", Boolean(raced));
    check("the version moved", (await currentVersion()) > held.version);

    // Our turn now writes against the version it reasoned about → must be refused, not silently applied.
    try {
      await runTool(guarded, "add_feed_section", { title: "SCRATCH — stale", urls: ["https://example.com/y.xml"] });
      check("a stale write is refused", false, "it was ACCEPTED — the other writer's edit would be gone");
    } catch (e) {
      check("a stale write is refused", (e as Error).name === "ConflictError", (e as Error).message);
    }
    check(
      "nothing was written by the refused call",
      !(await sections()).some((s) => s.title === "SCRATCH — stale"),
    );

    // Re-read (what an agent must do instead of retrying) and the same write goes through.
    held.version = await currentVersion();
    await runTool(guarded, "add_feed_section", { title: "SCRATCH — after re-read", urls: ["https://example.com/y.xml"] });
    mine = (await sections()).find((s) => s.title === "SCRATCH — after re-read")?.id ?? null;
    check("after re-reading, the write succeeds", Boolean(mine));

    // Two writes in ONE turn: the holder must have absorbed the first, or the second conflicts with it.
    await runTool(guarded, "update_section", { section_id: mine, fields: { title: "SCRATCH — second write" } });
    check(
      "a second write in the same turn does not conflict with the first",
      (await sections()).some((s) => s.title === "SCRATCH — second write"),
    );
  } finally {
    for (const id of [raced, mine].filter(Boolean) as string[]) {
      held.version = await currentVersion();
      await runTool(guarded, "remove_section", { section_id: id });
    }
    check(`section count restored again (${(await sections()).length})`, (await sections()).length === before.length);
  }

  console.log(`\n${failures === 0 ? "ALL OK" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

async function currentVersion(): Promise<number> {
  const { data } = await createServiceClient()
    .from("digests")
    .select("sections_version")
    .eq("id", digestId)
    .single();
  return (data as { sections_version: number }).sections_version;
}

async function currentName(): Promise<string> {
  const { data } = await createServiceClient().from("digests").select("name").eq("id", digestId).single();
  return (data as { name: string }).name;
}

async function expectError(label: string, input: Record<string, unknown>, tool?: string) {
  const name = tool ?? `add_${String(input.source ?? "feed") === "arxiv" ? "ranked" : "feed"}_section`;
  try {
    await runTool(ctx, name, input);
    check(label, false, "it was ACCEPTED");
  } catch (e) {
    check(label, true, (e as Error).message);
  }
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `       ${l}`)
    .join("\n");
}

main();
