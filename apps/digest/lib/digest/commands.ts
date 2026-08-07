import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeFieldValue, parseSectionFields } from "./sectionSchema";
import type { Cadence, Section, SectionKind } from "./types";

// THE WRITE SURFACE. Every change anyone can make to a digest is one of these commands, and every one of
// them lands here — the forms today, an agent tomorrow, an importer or a public API after that.
//
// The shape is ports-and-adapters: this module is the PORT (typed input, no framework), and each caller is
// a thin ADAPTER that translates its own protocol into a Command.
//
//     app/digests/actions.ts   FormData ──► Command ──┐
//     (an agent tool)          JSON     ──► Command ──┤──► applyCommand ──► digests row
//
// The alternative — an agent that writes its own read-modify-write against `digests.sections` — is the
// **multi-mirror drift** this codebase keeps paying to remove. `sectionSchema.ts` killed it for "what fields
// does a kind have"; this kills it for "what happens when you save one". A second write path would agree
// with the form on the day it was written and drift the first time either changed.
//
// Three deliberate exclusions keep the port framework-free, so it can be called from a script, a route
// handler, or a server action without knowing which:
//
//   - **No `revalidatePath`.** Commands RETURN the paths to revalidate; the adapter calls Next. (Calling it
//     outside a request context throws, which would make this module untestable from a script.)
//   - **No `redirect`.** `create_digest` returns the new id and the adapter decides where to go.
//   - **No auth assumptions beyond the client.** Everything runs through the caller's RLS-enforcing client.
//     The service role belongs to the 6am pipeline; nothing a browser or an agent can reach should hold it.
//
// Not here on purpose: `preview` / `run now` / `regenerate`. Those aren't config edits — they're the
// pipeline, they already have routes, and they cost money. When the agent gets them they should stay
// separate for exactly that reason: this module is the surface where writes are cheap and reversible.

export interface DigestPatch {
  name?: string;
  timezone?: string;
  deliver_at?: string;
  voice?: string | null;
  active?: boolean;
  ai_enabled?: boolean;
  web_search_enabled?: boolean;
}

/**
 * Per-kind section fields, as native values — `urls: ["https://…"]`, `days: 3`.
 *
 * Deliberately NOT pre-parsed: `parseSectionFields` is the one interpreter of what a field means, and it is
 * shared with the form. A caller that parsed its own values would be a second interpreter.
 */
export type SectionFields = Record<string, unknown>;

export type Command =
  | { type: "create_digest"; patch?: DigestPatch }
  | { type: "update_digest"; digestId: number; patch: DigestPatch }
  | {
      type: "add_section";
      digestId: number;
      kind: SectionKind;
      fields: SectionFields;
      max_items?: number;
      expectedVersion?: number;
    }
  | {
      type: "update_section";
      digestId: number;
      sectionId: string;
      kind: SectionKind;
      fields: SectionFields;
      max_items?: number;
      expectedVersion?: number;
    }
  | { type: "remove_section"; digestId: number; sectionId: string; expectedVersion?: number }
  | { type: "forget_message"; digestId: number; messageId: number };

export interface CommandResult {
  /** Paths the adapter should revalidate. Layout-scoped where the digest's NAME is involved (it lives in the shared header above the tabs). */
  revalidate: Array<{ path: string; scope?: "layout" }>;
  /** `create_digest` only. */
  digestId?: number;
  /**
   * The `sections_version` AFTER a section write. A caller making several writes in one turn must carry
   * this into the next one, or its second write conflicts with its own first.
   */
  sectionsVersion?: number;
  /** One line describing what happened, in the past tense. The agent reports this; a form ignores it. */
  summary: string;
}

export async function applyCommand(supabase: SupabaseClient, cmd: Command): Promise<CommandResult> {
  switch (cmd.type) {
    case "create_digest":
      return createDigest(supabase, cmd.patch ?? {});
    case "update_digest":
      return updateDigest(supabase, cmd.digestId, cmd.patch);
    case "add_section":
      return addSection(supabase, cmd);
    case "update_section":
      return updateSection(supabase, cmd);
    case "remove_section":
      return removeSection(supabase, cmd.digestId, cmd.sectionId, cmd.expectedVersion);
    case "forget_message":
      return forgetMessage(supabase, cmd.digestId, cmd.messageId);
  }
}

// ---------------------------------------------------------------------------------------------------
// Digest-level
// ---------------------------------------------------------------------------------------------------

async function createDigest(supabase: SupabaseClient, patch: DigestPatch): Promise<CommandResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("digests")
    .insert({
      owner_id: user.id,
      name: patch.name || "Morning Digest",
      timezone: patch.timezone || "UTC",
      deliver_at: patch.deliver_at || "06:00",
      voice: patch.voice || null,
      ai_enabled: patch.ai_enabled ?? false,
      web_search_enabled: patch.web_search_enabled ?? false,
      sections: [],
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const digestId = (data as { id: number }).id;
  return { revalidate: [{ path: "/" }], digestId, summary: `Created digest #${digestId}.` };
}

/**
 * A PATCH, not a replacement: only the keys actually present are written.
 *
 * The forms pass every field every time, so nothing changes for them. It matters for any caller holding a
 * partial intent — "rename this digest" must not blank the voice it didn't mention. A whole-object update
 * is a fine contract for a form (which always has the whole object) and a trap for everything else.
 */
async function updateDigest(
  supabase: SupabaseClient,
  digestId: number,
  patch: DigestPatch,
): Promise<CommandResult> {
  const update: Record<string, unknown> = {};
  for (const key of [
    "name",
    "timezone",
    "deliver_at",
    "voice",
    "active",
    "ai_enabled",
    "web_search_enabled",
  ] as const) {
    if (patch[key] !== undefined) update[key] = patch[key];
  }
  if (Object.keys(update).length === 0) {
    return { revalidate: [], summary: "Nothing to change." };
  }

  const { error } = await supabase.from("digests").update(update).eq("id", digestId);
  if (error) throw new Error(error.message);

  return {
    // "layout" scope, not the default page scope: the digest's name lives in the shared header above the
    // tabs, so a rename has to invalidate the layout as well as the tab body that submitted the form.
    revalidate: [{ path: `/digests/${digestId}`, scope: "layout" }],
    summary: `Updated ${Object.keys(update).join(", ")}.`,
  };
}

// ---------------------------------------------------------------------------------------------------
// Sections — read-modify-write over the `sections` jsonb (policy-as-data, so no schema change per kind)
// ---------------------------------------------------------------------------------------------------

/**
 * Turn raw field values into a Section, or refuse.
 *
 * The refusal is the point. Before it, a `feed` with no URLs or a `ranked` with no target saved happily and
 * then gathered nothing every morning, forever — a section that could not possibly work, with no signal
 * anywhere. An empty `search` query was worse: it still billed an Opus call to produce nothing.
 *
 * Identity/bookkeeping comes from the caller because "new section" and "editing one" disagree about where
 * those values come from (a fresh default vs. carried over).
 */
function buildSection(
  fields: SectionFields,
  identity: { id: string; kind: SectionKind; max_items: number; enabled: boolean },
): Section {
  const { values, missing } = parseSectionFields(identity.kind, (name) =>
    normalizeFieldValue(fields[name]),
  );
  if (missing.length) {
    throw new Error(
      `${identity.kind} sections need ${missing.join(" and ")}. ` +
        `A section missing that can never produce anything, so it isn't saved.`,
    );
  }

  const cadence = normalizeFieldValue(fields.cadence);
  return {
    ...identity,
    ...values,
    instructions: normalizeFieldValue(fields.instructions) || undefined,
    // Omitted rather than stored when it's the default: "no cadence" and "daily" mean the same thing, and
    // one of them doesn't need a row of jsonb to say so.
    cadence: cadence && cadence !== "daily" ? (cadence as Cadence) : undefined,
    weekday: cadence === "weekly" ? Number(normalizeFieldValue(fields.weekday)) || 0 : undefined,
  } as Section;
}

/**
 * Which version a write must match. There are TWO windows, and only the caller knows about the long one:
 *
 *   - the SHORT window is inside `applyCommand` — read, modify, write, a few milliseconds. Guarded for free
 *     by using the version just read, which is what a form gets without passing anything.
 *   - the LONG window belongs to an agent: it reads the digest at the start of a turn, thinks for twenty
 *     seconds, and only then writes. Guarding the short window would do nothing for it, so the caller
 *     passes the version it actually reasoned about, and the write is checked against *that*.
 *
 * Which is why `expectedVersion` is a caller concern rather than something this module could infer.
 */
function guard(expected: number | undefined, current: number): number {
  return expected ?? current;
}

/**
 * Raised when a section write lost a race. Its own class because the right RESPONSE differs by caller: a
 * form can re-render, but an agent must re-read and reconsider rather than retry — a retry would re-apply
 * an intent computed against a configuration that no longer exists.
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

async function readSections(
  supabase: SupabaseClient,
  digestId: number,
): Promise<{ sections: Section[]; version: number }> {
  const { data, error } = await supabase
    .from("digests")
    .select("sections, sections_version")
    .eq("id", digestId)
    .single();
  if (error) throw new Error(error.message);
  const row = data as { sections: Section[] | null; sections_version: number };
  return { sections: (row.sections ?? []) as Section[], version: row.sections_version };
}

/**
 * Compare-and-swap on the whole array: the UPDATE only matches while `sections_version` is still what we
 * read, and bumps it in the same statement. Zero rows back means a concurrent writer won.
 *
 * `.select("id")` is what makes "zero rows" observable — a plain update reports no error when it matches
 * nothing, which is exactly the silence this whole mechanism exists to end.
 */
async function writeSections(
  supabase: SupabaseClient,
  digestId: number,
  sections: Section[],
  version: number,
): Promise<number> {
  const { data, error } = await supabase
    .from("digests")
    .update({ sections, sections_version: version + 1 })
    .eq("id", digestId)
    .eq("sections_version", version)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new ConflictError(
      "This digest's sections changed while you were working. Re-read it before writing again — " +
        "the change you were about to make was based on a version that no longer exists.",
    );
  }
  return version + 1;
}

async function addSection(
  supabase: SupabaseClient,
  cmd: Extract<Command, { type: "add_section" }>,
): Promise<CommandResult> {
  const { sections: existing, version } = await readSections(supabase, cmd.digestId);
  const at = guard(cmd.expectedVersion, version);
  const section = buildSection(cmd.fields, {
    // Timestamp-based id: stable across edits, and unique enough for a hand-authored list.
    id: `s${Date.now().toString(36)}`,
    kind: cmd.kind,
    max_items: cmd.max_items || 5,
    enabled: true,
  });

  const sectionsVersion = await writeSections(supabase, cmd.digestId, [...existing, section], at);
  return {
    revalidate: [{ path: `/digests/${cmd.digestId}`, scope: "layout" }],
    sectionsVersion,
    summary: `Added a ${cmd.kind} section, “${section.title}”.`,
  };
}

async function updateSection(
  supabase: SupabaseClient,
  cmd: Extract<Command, { type: "update_section" }>,
): Promise<CommandResult> {
  const { sections: existing, version } = await readSections(supabase, cmd.digestId);
  const at = guard(cmd.expectedVersion, version);
  const current = existing.find((s) => s.id === cmd.sectionId);
  if (!current) throw new Error("Section not found");

  const section = buildSection(cmd.fields, {
    id: cmd.sectionId,
    kind: cmd.kind,
    max_items: cmd.max_items || current.max_items || 5,
    enabled: current.enabled ?? true,
  });

  const sectionsVersion = await writeSections(
    supabase,
    cmd.digestId,
    existing.map((s) => (s.id === cmd.sectionId ? section : s)),
    at,
  );
  return {
    revalidate: [{ path: `/digests/${cmd.digestId}`, scope: "layout" }],
    sectionsVersion,
    summary: `Updated “${section.title}”.`,
  };
}

async function removeSection(
  supabase: SupabaseClient,
  digestId: number,
  sectionId: string,
  expectedVersion?: number,
): Promise<CommandResult> {
  const { sections: existing, version } = await readSections(supabase, digestId);
  const at = guard(expectedVersion, version);
  const gone = existing.find((s) => s.id === sectionId);
  const sectionsVersion = await writeSections(
    supabase,
    digestId,
    existing.filter((s) => s.id !== sectionId),
    at,
  );
  return {
    revalidate: [{ path: `/digests/${digestId}`, scope: "layout" }],
    sectionsVersion,
    summary: gone ? `Removed “${gone.title}”.` : "Nothing to remove.",
  };
}

/**
 * Drop one inbound message.
 *
 * Deleting the message does NOT delete the `digest_posts` row it may have produced: that row is the record
 * of what was *delivered*, and rewriting delivery history to tidy a mailbox would be the wrong trade.
 */
async function forgetMessage(
  supabase: SupabaseClient,
  digestId: number,
  messageId: number,
): Promise<CommandResult> {
  const { error } = await supabase.from("digest_inbox_messages").delete().eq("id", messageId);
  if (error) throw new Error(error.message);
  return { revalidate: [{ path: `/digests/${digestId}/inbox` }], summary: "Deleted the message." };
}
