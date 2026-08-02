"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { applyCommand, type Command, type CommandResult } from "@/lib/digest/commands";
import { fieldsFor } from "@/lib/digest/sectionSchema";
import type { SectionKind } from "@/lib/digest/types";

// THE FORM ADAPTER. Nothing here decides anything — it translates FormData into a Command and hands it to
// `lib/digest/commands.ts`, which owns every write. See that file for why the split exists; the short
// version is that an agent (or an importer, or a test) needs the same writes without inventing FormData,
// and a second write path would drift from this one the first time either changed.
//
// What stays on THIS side of the line is the part that is genuinely Next-specific and genuinely a
// *presentation* decision: which paths to revalidate, and where to go afterwards. The command says what
// changed; the adapter decides what the browser does about it.
//
// All of these go through the request-scoped (RLS-enforcing) client on purpose — the service role belongs to
// the 6am pipeline, not to anything a browser can reach.

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

/** An unchecked checkbox submits nothing at all, so "absent" means false — never "unchanged". */
function checked(form: FormData, key: string): boolean {
  return form.get(key) === "on";
}

/**
 * Run a command and apply its revalidations.
 *
 * Forms submit every field they render, so they always send a whole object — which is why passing a full
 * patch here is right for a form and would be wrong for a caller holding a partial intent (see
 * `updateDigest` in commands.ts).
 */
async function run(cmd: Command): Promise<CommandResult> {
  const result = await applyCommand(createClient(), cmd);
  for (const r of result.revalidate) revalidatePath(r.path, r.scope);
  return result;
}

/**
 * The per-kind fields, straight off the form.
 *
 * The field LIST comes from `sectionSchema.ts` rather than being written out here — that declaration is
 * already what the form rendered from and what the parser enforces, so reading it back is a lookup, not a
 * third copy. `cadence`/`weekday`/`instructions` are on every kind, so they ride along by name.
 */
function sectionFields(form: FormData, kind: SectionKind): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of fieldsFor(kind)) fields[field.name] = str(form, field.name);
  fields.instructions = str(form, "instructions");
  fields.cadence = str(form, "cadence");
  fields.weekday = str(form, "weekday");
  return fields;
}

export async function createDigest(form: FormData) {
  const { digestId } = await run({
    type: "create_digest",
    patch: {
      name: str(form, "name"),
      timezone: str(form, "timezone"),
      deliver_at: str(form, "deliver_at"),
      voice: str(form, "voice") || null,
      ai_enabled: checked(form, "ai_enabled"),
      web_search_enabled: checked(form, "web_search_enabled"),
    },
  });
  redirect(`/digests/${digestId}`);
}

export async function updateDigest(form: FormData) {
  await run({
    type: "update_digest",
    digestId: Number(form.get("id")),
    patch: {
      name: str(form, "name"),
      timezone: str(form, "timezone"),
      deliver_at: str(form, "deliver_at"),
      voice: str(form, "voice") || null,
      active: checked(form, "active"),
      ai_enabled: checked(form, "ai_enabled"),
      web_search_enabled: checked(form, "web_search_enabled"),
    },
  });
}

export async function addSection(form: FormData) {
  const kind = str(form, "kind") as SectionKind;
  await run({
    type: "add_section",
    digestId: Number(form.get("id")),
    kind,
    fields: sectionFields(form, kind),
    max_items: Number(form.get("max_items")) || undefined,
  });
}

export async function updateSection(form: FormData) {
  const kind = str(form, "kind") as SectionKind;
  await run({
    type: "update_section",
    digestId: Number(form.get("id")),
    sectionId: str(form, "section_id"),
    kind,
    fields: sectionFields(form, kind),
    max_items: Number(form.get("max_items")) || undefined,
  });
}

export async function removeSection(form: FormData) {
  await run({
    type: "remove_section",
    digestId: Number(form.get("id")),
    sectionId: str(form, "section_id"),
  });
}

export async function forgetMessage(form: FormData) {
  await run({
    type: "forget_message",
    digestId: Number(form.get("id")),
    messageId: Number(form.get("message_id")),
  });
}
