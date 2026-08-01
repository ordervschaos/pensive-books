"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Cadence, RankedSection, ReadwiseSection, Section, SectionKind } from "@/lib/digest/types";

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
      web_search_enabled: form.get("web_search_enabled") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  // "layout" scope, not the default page scope: the digest's name lives in the shared header above the tabs,
  // so a rename has to invalidate the layout as well as the tab body that submitted the form.
  revalidatePath(`/digests/${id}`, "layout");
}

// Sections live as jsonb (policy-as-data), so add/remove is a read-modify-write of the array rather than a
// schema change per source kind.
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

  const cadence = str(form, "cadence");
  const base = {
    // Timestamp-based id: stable across edits, and unique enough for a hand-authored list.
    id: `s${Date.now().toString(36)}`,
    kind,
    title: str(form, "title") || "Untitled section",
    instructions: str(form, "instructions") || undefined,
    max_items: Number(form.get("max_items")) || 5,
    enabled: true,
    // Omitted rather than stored when it's the default: "no cadence" and "daily" mean the same thing, and
    // one of them doesn't need a row of jsonb to say so.
    cadence: cadence && cadence !== "daily" ? (cadence as Cadence) : undefined,
    weekday: cadence === "weekly" ? Number(form.get("weekday")) || 0 : undefined,
  };

  // Shared parsers. A list field is whitespace-or-comma separated everywhere in this form, so it is parsed
  // in one place rather than four slightly different ones.
  const list = (key: string) =>
    str(form, key)
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  const num = (key: string) => (Number(form.get(key)) > 0 ? Number(form.get(key)) : undefined);

  let section: Section;
  switch (kind) {
    case "search":
      section = { ...base, kind: "search", query: str(form, "query") };
      break;
    case "feed":
      section = {
        ...base,
        kind: "feed",
        urls: str(form, "urls").split(/[\s,]+/).filter((u) => u.startsWith("http")),
      };
      break;
    case "serial":
      section = {
        ...base,
        kind: "serial",
        book_id: Number(form.get("book_id")),
        pages_per_day: Number(form.get("pages_per_day")) || 1,
      };
      break;
    case "readwise":
      section = {
        ...base,
        kind: "readwise",
        mode: str(form, "readwise_mode") === "random" ? "random" : "review",
        // "any" is the empty case, not a value — a section with no category draws from the whole vault.
        category: (str(form, "readwise_category") || undefined) as ReadwiseSection["category"],
      };
      break;
    case "ranked":
      section = {
        ...base,
        kind: "ranked",
        source: (str(form, "ranked_source") || "hn") as RankedSection["source"],
        query: str(form, "query") || undefined,
        targets: list("targets"),
        min_score: num("min_score"),
        days: num("days"),
      };
      break;
    case "inbox":
      section = {
        ...base,
        kind: "inbox",
        // Sender filters are matched as substrings, so "stratechery.com" and a full address both work.
        senders: list("senders"),
        days: num("days"),
      };
      break;
    case "unread":
      section = {
        ...base,
        kind: "unread",
        min_age_days: num("min_age_days"),
        max_age_days: num("max_age_days"),
      };
      break;
    case "sitewatch":
      section = {
        ...base,
        kind: "sitewatch",
        urls: list("urls").filter((u) => u.startsWith("http")),
      };
      break;
    case "video":
      section = {
        ...base,
        kind: "video",
        channels: list("channels"),
        days: num("days"),
      };
      break;
    case "quiz":
      section = {
        ...base,
        kind: "quiz",
        over: str(form, "quiz_over") === "today" ? "today" : "previous",
      };
      break;
    default:
      section = { ...base, kind: "prompt" };
  }

  const sections = [...((digest.sections ?? []) as Section[]), section];
  const { error } = await supabase.from("digests").update({ sections }).eq("id", id);
  if (error) throw new Error(error.message);
  // "layout" scope, not the default page scope: the digest's name lives in the shared header above the tabs,
  // so a rename has to invalidate the layout as well as the tab body that submitted the form.
  revalidatePath(`/digests/${id}`, "layout");
}

export async function updateSectionMaxItems(id: number, sectionId: string, maxItems: number) {
  const supabase = createClient();
  const { data: digest, error: readErr } = await supabase
    .from("digests")
    .select("sections")
    .eq("id", id)
    .single();
  if (readErr) throw new Error(readErr.message);

  const sections = ((digest.sections ?? []) as Section[]).map((s) =>
    s.id === sectionId ? { ...s, max_items: maxItems } : s,
  );
  const { error } = await supabase.from("digests").update({ sections }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/digests/${id}`, "layout");
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
