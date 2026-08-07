import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCommand } from "../commands";
import { loadReadiness } from "../readiness";
import { BASE_FIELDS, SECTION_FIELDS, fieldsFor } from "../sectionSchema";
import type { Field } from "../sectionSchema";
import type { Digest, IssueContent, Section, SectionKind } from "../types";

// THE AGENT'S TOOL BELT — the third consumer of `sectionSchema.ts`.
//
// The form renders from that declaration and the parser enforces from it; here it becomes JSON Schema. So
// "everything the user can do, the agent can do" is a DERIVATION rather than a checklist someone maintains.
// Add a field to a kind and the form, the parser and the tool all gain it in one edit — which is the only
// version of that promise that survives contact with a second month of development.
//
// Two scoping decisions are load-bearing:
//
//   1. **The digest id is AMBIENT, never a parameter.** One thread per digest, so `ToolCtx` carries the id
//      and no tool exposes it. That is a security property, not a convenience: there is no argument the
//      model can emit that reaches someone else's digest, and no prompt that can talk it into trying.
//   2. **`create_digest` is deliberately absent.** The agent works *inside* a digest; creating one is the
//      entry point and stays a form. Admitting it would mean giving the belt an unscoped tool purely for
//      symmetry, which is how the invariant above dies.
//
// Writes all land in `applyCommand` (see ../commands.ts). Nothing here does its own read-modify-write.

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolCtx {
  /** RLS-enforcing, request-scoped. The service role belongs to the 6am pipeline. */
  supabase: SupabaseClient;
  digestId: number;
  /**
   * Optimistic-concurrency guard for section writes, owned by the CALLER and mutated here.
   *
   * The loop reads `digests.sections_version` once at the start of a turn and puts it in this holder; every
   * section write is then checked against the version the agent actually reasoned about, not against
   * whatever the row says a millisecond before the write. That is the only version of the guard that
   * closes the agent's real window — it thinks for twenty seconds between reading and writing.
   *
   * Deliberately NOT a tool parameter: a model echoing a version back correctly on every call is not a
   * property worth depending on, and it would be one more thing in the schema for it to get wrong.
   *
   * Mutated after each successful write, or the agent's second write in a turn conflicts with its first.
   */
  sections?: { version: number };
}

// ---------------------------------------------------------------------------------------------------
// sectionSchema → JSON Schema
// ---------------------------------------------------------------------------------------------------

/**
 * One field's JSON Schema. `hint` becomes `description` — the same sentence that stops a human filling the
 * form wrong is the one that stops the model, and there is no second copy to drift.
 */
function schemaForField(field: Field): Record<string, unknown> {
  const description = [
    field.hint,
    field.placeholder && `e.g. ${field.placeholder}`,
    // `requiredWhen` can't be said in a flat schema, so it is said in words. One real case (ranked.targets).
    field.requiredWhen &&
      `Required when ${field.requiredWhen.field} is ${field.requiredWhen.in.join(", ")}.`,
  ]
    .filter(Boolean)
    .join(" ");

  const base: Record<string, unknown> = description ? { description } : {};
  switch (field.type) {
    case "number":
      return { ...base, type: "integer", minimum: 1 };
    case "select":
      return { ...base, type: "string", enum: field.options?.map((o) => o.value) ?? [] };
    case "urls":
      return { ...base, type: "array", items: { type: "string", format: "uri" } };
    case "list":
      return { ...base, type: "array", items: { type: "string" } };
    default:
      return { ...base, type: "string" };
  }
}

// Every kind carries these, so they are declared once here rather than eleven times in the generated
// schemas. (They live on `SectionBase` in types.ts, which has no field declarations of its own.)
const COMMON_PROPERTIES: Record<string, unknown> = {
  instructions: {
    type: "string",
    description: "What to look for in this section and what to do with it. Optional.",
  },
  cadence: {
    type: "string",
    enum: ["daily", "weekdays", "weekly"],
    description:
      "How often this section runs, against the reader's local date. Omit for daily. A weekly-volume beat on a daily cadence mostly yields silence.",
  },
  weekday: {
    type: "integer",
    minimum: 0,
    maximum: 6,
    description: "Weekly cadence only: 0 = Sunday … 6 = Saturday.",
  },
  max_items: {
    type: "integer",
    minimum: 1,
    description: "Hard cap on items handed to the writer. Default 5.",
  },
};

function sectionProperties(kind: SectionKind): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const field of fieldsFor(kind)) properties[field.name] = schemaForField(field);
  return { ...properties, ...COMMON_PROPERTIES };
}

/**
 * What a kind IS, in one line, for the tool description. Taken from the `hint` of its most characteristic
 * field where there is one — again, no second copy.
 */
const KIND_SUMMARY: Record<SectionKind, string> = {
  feed: "RSS/Atom feeds. No model call to gather; several feeds are read round-robin so a daily publisher can't crowd out a monthly one.",
  ranked: "A source that ships its own ranking signal — HN points, arXiv categories, GitHub releases, subreddits, Lobsters.",
  inbox: "Newsletters mailed to this digest's own address. The only push source; the cheapest in the app.",
  video: "YouTube channels or podcast RSS, read instead of watched. Transcript where one exists.",
  readwise: "Quotes from the reader's own Readwise vault. Printed verbatim — no model touches them.",
  unread: "The corpus's own leftovers: posts this digest fetched and never used.",
  sitewatch: "Pages with no feed. Emits nothing unless the page actually changed.",
  search: "Live web search. THE ONE PAID GATHER PATH — it bills every run whether or not it finds anything, and needs both AI writing and web search enabled on the digest.",
  quiz: "A closer, not a source: recall questions over the sections that were written. Runs last, and only if something was written.",
  prompt: "Generated from the digest's voice with no retrieval at all. Needs AI writing enabled.",
};

/** One `add_<kind>_section` tool per kind. Generated, so the count is free and no kind can be forgotten. */
function addSectionTools(): ToolDef[] {
  return (Object.keys(SECTION_FIELDS) as SectionKind[]).map((kind) => ({
    name: `add_${kind}_section`,
    description: `Add a ${kind} section to this digest. ${KIND_SUMMARY[kind]}`,
    input_schema: {
      type: "object" as const,
      properties: sectionProperties(kind),
      required: [...BASE_FIELDS, ...SECTION_FIELDS[kind]].filter((f) => f.required).map((f) => f.name),
    },
  }));
}

// ---------------------------------------------------------------------------------------------------
// The belt
// ---------------------------------------------------------------------------------------------------

export const TOOLS: ToolDef[] = [
  // --- reads. Cheap, side-effect-free, and the reason the agent can reason instead of guess. ---
  {
    name: "read_digest",
    description:
      "The digest's settings and every section it has, with ids. Start here — section ids come from this.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_readiness",
    description:
      "What would silently fail or under-deliver at 6am: sections that get skipped, sources that have stopped producing, settings that stop the whole digest. Derived from data, not stored.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_issues",
    description:
      "Recent issues: date, status, item count, and which sections made it in. Use it to see what a section has actually been contributing.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 20, description: "Default 5." } },
    },
  },
  {
    name: "read_issue_section",
    description:
      "The written text of one section of one issue. Costly in context — read the issue list first and ask for the one section you actually need.",
    input_schema: {
      type: "object",
      properties: {
        issue_date: { type: "string", description: "YYYY-MM-DD, from read_issues." },
        section_id: { type: "string" },
      },
      required: ["issue_date", "section_id"],
    },
  },
  {
    name: "read_posts",
    description:
      "The corpus: every post this digest pulled, used or not, with the AGE OF THE WRITING. The unused half is the evidence for whether a source is earning its place — a feed serving six-year-old archive posts is only visible here.",
    input_schema: {
      type: "object",
      properties: {
        section_id: { type: "string", description: "Restrict to one section." },
        used: { type: "boolean", description: "true = only delivered, false = only passed over." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 30." },
      },
    },
  },
  {
    name: "read_inbox",
    description: "Messages mailed to this digest's inbound address.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 20." } },
    },
  },

  // --- writes. Every one lands in applyCommand. ---
  ...addSectionTools(),
  {
    name: "update_section",
    description:
      "Change fields on an existing section. A PATCH: fields you omit keep their current values, so you can change a title without resending the urls.",
    input_schema: {
      type: "object",
      properties: {
        section_id: { type: "string" },
        fields: {
          type: "object",
          description:
            "Only the fields to change, using the same names the add tool for this kind uses.",
        },
      },
      required: ["section_id", "fields"],
    },
  },
  {
    name: "remove_section",
    description: "Delete a section. Destructive — confirm with the reader before calling it.",
    input_schema: {
      type: "object",
      properties: { section_id: { type: "string" } },
      required: ["section_id"],
    },
  },
  {
    name: "update_digest",
    description:
      "Change the digest's own settings. A PATCH: omitted keys are left alone. Turning on ai_enabled or web_search_enabled COSTS MONEY every run — confirm with the reader first.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        timezone: { type: "string", description: "IANA name, e.g. Asia/Kolkata." },
        deliver_at: { type: "string", description: "Wall-clock time in that timezone, HH:MM." },
        voice: {
          type: "string",
          description:
            "The reader's standing editorial voice, applied to every section — what they care about and what to skip.",
        },
        active: { type: "boolean" },
        ai_enabled: { type: "boolean", description: "Paid. Off = sections ship as plain linked lists." },
        web_search_enabled: { type: "boolean", description: "Paid, per run. Only `search` sections use it." },
      },
    },
  },
  {
    name: "forget_message",
    description:
      "Delete one inbound message. Destructive. It does not delete the record of anything already delivered from it.",
    input_schema: {
      type: "object",
      properties: { message_id: { type: "integer" } },
      required: ["message_id"],
    },
  },
];

// ---------------------------------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------------------------------

/**
 * Run one tool call and return what the model should see.
 *
 * Results are TEXT, and deliberately compact: in a tool loop the transcript is dominated by tool results,
 * not by anything anyone typed. Nothing here returns a body or a full issue unless it was asked for by id —
 * the corpus and the issues are a query away, so they don't need to be resident in context.
 *
 * Throws on failure. The caller turns that into an error tool_result; the model reads it and adjusts, which
 * is why the refusal messages are written for a reader rather than for a log.
 */
export async function runTool(ctx: ToolCtx, name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "read_digest":
      return readDigest(ctx);
    case "check_readiness":
      return checkReadiness(ctx);
    case "read_issues":
      return readIssues(ctx, num(input.limit, 5));
    case "read_issue_section":
      return readIssueSection(ctx, String(input.issue_date), String(input.section_id));
    case "read_posts":
      return readPosts(ctx, input);
    case "read_inbox":
      return readInbox(ctx, num(input.limit, 20));
    case "update_section":
      return updateSection(ctx, String(input.section_id), (input.fields ?? {}) as Record<string, unknown>);
    case "remove_section":
      return write(ctx, { type: "remove_section", digestId: ctx.digestId, sectionId: String(input.section_id) });
    case "update_digest":
      return write(ctx, { type: "update_digest", digestId: ctx.digestId, patch: input });
    case "forget_message":
      return write(ctx, {
        type: "forget_message",
        digestId: ctx.digestId,
        messageId: num(input.message_id, 0),
      });
    default: {
      const kind = name.match(/^add_(\w+)_section$/)?.[1] as SectionKind | undefined;
      if (kind && kind in SECTION_FIELDS) {
        return write(ctx, {
          type: "add_section",
          digestId: ctx.digestId,
          kind,
          fields: input,
          max_items: num(input.max_items, 0) || undefined,
        });
      }
      throw new Error(`Unknown tool: ${name}`);
    }
  }
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** The commands that rewrite the `sections` array, and so must carry the concurrency guard. */
const VERSIONED = new Set(["add_section", "update_section", "remove_section"]);

async function write(ctx: ToolCtx, cmd: Parameters<typeof applyCommand>[1]): Promise<string> {
  // Keyed on `cmd.type`, not on `"expectedVersion" in cmd` — the field is optional, so it is absent at
  // runtime until something sets it, and the `in` check would silently never fire.
  const withGuard =
    ctx.sections && VERSIONED.has(cmd.type) ? { ...cmd, expectedVersion: ctx.sections.version } : cmd;
  const result = await applyCommand(ctx.supabase, withGuard as typeof cmd);
  if (ctx.sections && result.sectionsVersion !== undefined) ctx.sections.version = result.sectionsVersion;
  return result.summary;
}

/**
 * Merge before writing, so an omitted field means "leave it" rather than "clear it".
 *
 * The underlying command replaces the whole section, which is right for a form (it always submits every
 * field) and a trap for anything else: an agent changing a title would silently drop the urls, and then the
 * required-field check would refuse the write it had just been asked to make. Merging is the adapter doing
 * protocol translation — exactly what an adapter is for.
 *
 * `kind` is taken from the stored section rather than accepted as input: nothing about "change the title"
 * should be able to turn a feed into a search.
 */
async function updateSection(
  ctx: ToolCtx,
  sectionId: string,
  patch: Record<string, unknown>,
): Promise<string> {
  const sections = await sectionsOf(ctx);
  const current = sections.find((s) => s.id === sectionId);
  if (!current) throw new Error(`No section with id ${sectionId}. Call read_digest for the current ids.`);

  // Section properties ARE the field names (sectionSchema's one rule), so the stored section is already the
  // right shape to merge into — minus the identity/bookkeeping keys, which the command supplies itself.
  const { id: _id, kind: _kind, enabled: _enabled, max_items, ...fields } = current as Record<string, unknown> &
    Section;

  return write(ctx, {
    type: "update_section",
    digestId: ctx.digestId,
    sectionId,
    kind: current.kind,
    fields: { ...fields, ...patch },
    max_items: num(patch.max_items, 0) || max_items,
  });
}

// ---------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------

type DigestRow = Pick<
  Digest,
  | "id"
  | "owner_id"
  | "name"
  | "sections"
  | "active"
  | "timezone"
  | "deliver_at"
  | "voice"
  | "ai_enabled"
  | "web_search_enabled"
  | "delivery"
>;

const DIGEST_COLUMNS =
  "id, owner_id, name, sections, active, timezone, deliver_at, voice, ai_enabled, web_search_enabled, delivery";

async function digestOf(ctx: ToolCtx): Promise<DigestRow & { sections_version: number }> {
  const { data, error } = await ctx.supabase
    .from("digests")
    .select(`${DIGEST_COLUMNS}, sections_version`)
    .eq("id", ctx.digestId)
    .single();
  if (error) throw new Error(error.message);
  return data as DigestRow & { sections_version: number };
}

async function sectionsOf(ctx: ToolCtx): Promise<Section[]> {
  return (await digestOf(ctx)).sections ?? [];
}

async function readDigest(ctx: ToolCtx): Promise<string> {
  const d = await digestOf(ctx);
  // Reading is OBSERVING, so it moves the concurrency guard forward: the version holder tracks the newest
  // state the agent has actually looked at. Without this the remedy for a conflict — "re-read, then decide"
  // — could never succeed, because the write after the re-read would still be checked against the version
  // from the top of the turn. Deliberately only here, on the tool the model calls: the internal read inside
  // `update_section` must NOT refresh, or the guard would re-arm itself microseconds before every write and
  // protect nothing.
  if (ctx.sections) ctx.sections.version = d.sections_version;
  const head = [
    `${d.name} — ${d.active ? "active" : "PAUSED"}, delivered ${d.deliver_at} ${d.timezone}`,
    `ai_enabled=${d.ai_enabled} web_search_enabled=${d.web_search_enabled}`,
    d.voice ? `voice: ${d.voice}` : "voice: (none set)",
  ].join("\n");

  const sections = (d.sections ?? []).map(sectionLine).join("\n") || "  (no sections)";
  return `${head}\n\nSections:\n${sections}`;
}

function sectionLine(s: Section): string {
  const detail = Object.entries(s)
    .filter(([k]) => !["id", "kind", "title", "enabled", "instructions"].includes(k))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : v}`)
    .join(" ");
  return [
    `  ${s.id} · ${s.kind} · “${s.title}”`,
    s.enabled === false ? " · DISABLED" : "",
    detail ? `\n      ${detail}` : "",
    s.instructions ? `\n      instructions: ${s.instructions}` : "",
  ].join("");
}

async function checkReadiness(ctx: ToolCtx): Promise<string> {
  const r = await loadReadiness(ctx.supabase, await digestOf(ctx));
  if (!r.notes.length) return "Ready — nothing will be skipped at delivery.";
  return r.notes
    .map((n) => `${n.level === "blocking" ? "BLOCKING" : "degrading"}: ${n.title} — ${n.detail}`)
    .join("\n");
}

async function readIssues(ctx: ToolCtx, limit: number): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("digest_issues")
    .select("issue_date, status, item_count, error, content")
    .eq("digest_id", ctx.digestId)
    .order("issue_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    issue_date: string;
    status: string;
    item_count: number;
    error: string | null;
    content: IssueContent | null;
  }>;
  if (!rows.length) return "No issues yet — this digest has never been built.";

  return rows
    .map((i) => {
      const ids = (i.content?.sections ?? []).map((s) => s.id).join(", ") || "(nothing)";
      return `${i.issue_date} · ${i.status} · ${i.item_count} items · sections: ${ids}${
        i.error ? ` · error: ${i.error}` : ""
      }`;
    })
    .join("\n");
}

async function readIssueSection(ctx: ToolCtx, issueDate: string, sectionId: string): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("digest_issues")
    .select("content")
    .eq("digest_id", ctx.digestId)
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const content = (data as { content: IssueContent | null } | null)?.content;
  if (!content) return `No issue on ${issueDate}.`;
  const section = (content.sections ?? []).find((s) => s.id === sectionId);
  if (!section) {
    const ids = (content.sections ?? []).map((s) => s.id).join(", ") || "(none)";
    return `That issue has no section ${sectionId}. It has: ${ids}`;
  }
  return `${section.title} (${issueDate})\n\n${section.markdown}`;
}

async function readPosts(ctx: ToolCtx, input: Record<string, unknown>): Promise<string> {
  let query = ctx.supabase
    .from("digest_posts")
    .select("title, url, source, section_id, published_at, used_at")
    .eq("digest_id", ctx.digestId)
    .order("fetched_at", { ascending: false })
    .limit(num(input.limit, 30));
  if (input.section_id) query = query.eq("section_id", String(input.section_id));
  if (input.used === true) query = query.not("used_at", "is", null);
  if (input.used === false) query = query.is("used_at", null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    title: string | null;
    url: string | null;
    source: string | null;
    section_id: string | null;
    published_at: string | null;
    used_at: string | null;
  }>;
  if (!rows.length) return "No posts match.";

  return rows
    .map(
      (p) =>
        `${p.used_at ? "used  " : "unused"} · ${p.section_id ?? "—"} · ${p.source ?? "—"} · ${ageLabel(
          p.published_at,
        )} · ${p.title ?? p.url ?? "(untitled)"}`,
    )
    .join("\n");
}

/** Age of the WRITING, not of the fetch — the distinction the whole corpus view exists to make. */
function ageLabel(published: string | null): string {
  if (!published) return "age unknown";
  const days = Math.floor((Date.now() - new Date(published).getTime()) / 86_400_000);
  if (!Number.isFinite(days)) return "age unknown";
  if (days < 1) return "today";
  if (days < 30) return `${days}d old`;
  if (days < 365) return `${Math.floor(days / 30)}mo old`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")}y old`;
}

async function readInbox(ctx: ToolCtx, limit: number): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("digest_inbox_messages")
    .select("id, sender, subject, received_at")
    .eq("digest_id", ctx.digestId)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    id: number;
    sender: string | null;
    subject: string | null;
    received_at: string;
  }>;
  if (!rows.length) return "Nothing has ever arrived at this digest's address.";
  return rows
    .map((m) => `#${m.id} · ${m.received_at.slice(0, 10)} · ${m.sender ?? "—"} · ${m.subject ?? "(no subject)"}`)
    .join("\n");
}
