"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Cadence, Section, SectionKind } from "@/lib/digest/types";
import { parseSectionFields } from "@/lib/digest/sectionSchema";

// Server actions for the config surface. All of these go through the request-scoped (RLS-enforcing) client
// on purpose — the service role belongs to the 6am pipeline, not to anything a browser can reach.

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export async function createDigest(form: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("digests")
    .insert({
      owner_id: user.id,
      name: str(form, "name") || "Morning Digest",
      timezone: str(form, "timezone") || "UTC",
      deliver_at: str(form, "deliver_at") || "06:00",
      voice: str(form, "voice") || null,
      ai_enabled: form.get("ai_enabled") === "on",
      web_search_enabled: form.get("web_search_enabled") === "on",
      sections: [],
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  redirect(`/digests/${data.id}`);
}

export async function updateDigest(form: FormData) {
  const id = Number(form.get("id"));
  const supabase = createClient();
  const { error } = await supabase
    .from("digests")
    .update({
      name: str(form, "name"),
      timezone: str(form, "timezone"),
      deliver_at: str(form, "deliver_at"),
      voice: str(form, "voice") || null,
      active: form.get("active") === "on",
      ai_enabled: form.get("ai_enabled") === "on",
      web_search_enabled: form.get("web_search_enabled") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  // "layout" scope, not the default page scope: the digest's name lives in the shared header above the tabs,
  // so a rename has to invalidate the layout as well as the tab body that submitted the form.
  revalidatePath(`/digests/${id}`, "layout");
}

// Shared by add and edit: turning the section form's FormData into a Section.
//
// Every per-kind field — which ones exist, which are required, how a raw string becomes a value — comes from
// `lib/digest/sectionSchema.ts`, the same declaration the form renders from. This function used to carry a
// switch with one hand-written branch per kind, which meant the field list lived here AND in the form AND in
// `types.ts`; three edits per new field and silent drift when one was missed.
//
// It throws on a missing required field. That is the whole point: before this check, a `feed` with no URLs
// or a `serial` with no book id saved happily and then gathered nothing every morning, forever — a section
// that could not possibly work, with no signal anywhere. An empty `search` query was worse: it still billed
// an Opus call to produce nothing.
//
// The identity/bookkeeping fields (id, max_items, enabled) come from the caller, because "new section" and
// "editing an existing one" disagree on where they come from (a fresh default vs. carried over).
function buildSection(
  form: FormData,
  identity: { id: string; kind: SectionKind; max_items: number; enabled: boolean },
): Section {
  const { values, missing } = parseSectionFields(identity.kind, (name) => str(form, name));
  if (missing.length) {
    throw new Error(
      `${identity.kind} sections need ${missing.join(" and ")}. ` +
        `A section missing that can never produce anything, so it isn't saved.`,
    );
  }

  const cadence = str(form, "cadence");
  return {
    ...identity,
    ...values,
    instructions: str(form, "instructions") || undefined,
    // Omitted rather than stored when it's the default: "no cadence" and "daily" mean the same thing, and
    // one of them doesn't need a row of jsonb to say so.
    cadence: cadence && cadence !== "daily" ? (cadence as Cadence) : undefined,
    weekday: cadence === "weekly" ? Number(form.get("weekday")) || 0 : undefined,
  } as Section;
}

// Sections live as jsonb (policy-as-data), so add/edit/remove is a read-modify-write of the array rather
// than a schema change per source kind.
export async function addSection(form: FormData) {
  const id = Number(form.get("id"));
  const kind = str(form, "kind") as SectionKind;
  const supabase = createClient();

  const { data: digest, error: readErr } = await supabase
    .from("digests")
    .select("sections")
    .eq("id", id)
    .single();
  if (readErr) throw new Error(readErr.message);

  const section = buildSection(form, {
    // Timestamp-based id: stable across edits, and unique enough for a hand-authored list.
    id: `s${Date.now().toString(36)}`,
    kind,
    max_items: Number(form.get("max_items")) || 5,
    enabled: true,
  });

  const sections = [...((digest.sections ?? []) as Section[]), section];
  const { error } = await supabase.from("digests").update({ sections }).eq("id", id);
  if (error) throw new Error(error.message);
  // "layout" scope, not the default page scope: the digest's name lives in the shared header above the tabs,
  // so a rename has to invalidate the layout as well as the tab body that submitted the form.
  revalidatePath(`/digests/${id}`, "layout");
}

export async function updateSection(form: FormData) {
  const id = Number(form.get("id"));
  const sectionId = str(form, "section_id");
  const kind = str(form, "kind") as SectionKind;
  const supabase = createClient();

  const { data: digest, error: readErr } = await supabase
    .from("digests")
    .select("sections")
    .eq("id", id)
    .single();
  if (readErr) throw new Error(readErr.message);

  const existing = ((digest.sections ?? []) as Section[]).find((s) => s.id === sectionId);
  if (!existing) throw new Error("Section not found");

  const section = buildSection(form, {
    id: sectionId,
    kind,
    max_items: Number(form.get("max_items")) || existing.max_items || 5,
    enabled: existing.enabled ?? true,
  });

  const sections = ((digest.sections ?? []) as Section[]).map((s) => (s.id === sectionId ? section : s));
  const { error } = await supabase.from("digests").update({ sections }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/digests/${id}`, "layout");
}

// Drop one inbound message. RLS already restricts DELETE to the digest's owner, so this is the request-
// scoped client like everything else here — the service role is the pipeline's, not the browser's.
//
// Deleting the message does NOT delete the digest_posts row it may have produced: that row is the record of
// what was *delivered*, and rewriting delivery history to tidy a mailbox would be the wrong trade.
export async function forgetMessage(form: FormData) {
  const id = Number(form.get("id"));
  const messageId = Number(form.get("message_id"));
  const supabase = createClient();

  const { error } = await supabase.from("digest_inbox_messages").delete().eq("id", messageId);
  if (error) throw new Error(error.message);
  revalidatePath(`/digests/${id}/inbox`);
}

export async function removeSection(form: FormData) {
  const id = Number(form.get("id"));
  const sectionId = str(form, "section_id");
  const supabase = createClient();

  const { data: digest, error: readErr } = await supabase
    .from("digests")
    .select("sections")
    .eq("id", id)
    .single();
  if (readErr) throw new Error(readErr.message);

  const sections = ((digest.sections ?? []) as Section[]).filter((s) => s.id !== sectionId);
  const { error } = await supabase.from("digests").update({ sections }).eq("id", id);
  if (error) throw new Error(error.message);
  // "layout" scope, not the default page scope: the digest's name lives in the shared header above the tabs,
  // so a rename has to invalidate the layout as well as the tab body that submitted the form.
  revalidatePath(`/digests/${id}`, "layout");
}
