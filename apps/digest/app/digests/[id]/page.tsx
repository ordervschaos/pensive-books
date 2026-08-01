import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Digest, Section } from "@/lib/digest/types";
import { removeSection } from "../actions";
import { AddSectionForm } from "./AddSectionForm";
import { InboxAddress } from "./InboxAddress";

export const dynamic = "force-dynamic";

const FIELD = "w-full rounded border border-rule bg-white px-3 py-2 text-sm";
const LABEL = "font-mono text-xs uppercase tracking-wider text-muted";

// The default tab: what this digest is made of. Sources are the thing you edit most, so they get the index
// URL; the settings form (edited once, then rarely) moved to its own tab.
export default async function SectionsPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data } = await supabase
    .from("digests")
    .select("id, sections, web_search_enabled, inbox_token")
    .eq("id", Number(params.id))
    .maybeSingle();
  if (!data) notFound();

  const digest = data as Pick<Digest, "id" | "sections" | "web_search_enabled" | "inbox_token">;
  const hasInbox = (digest.sections ?? []).some((s: Section) => s.kind === "inbox");

  // Readwise is an ACCOUNT-level connection, so its state is read separately and only to warn: a section
  // configured against a disconnected vault is silently skipped at 6am, and that should be visible here
  // rather than discovered from an issue that's missing a section. (RLS scopes this to the current user;
  // the token itself is never selected.)
  const { data: rw } = await supabase
    .from("digest_user_settings")
    .select("readwise_enabled, readwise_verified_at")
    .maybeSingle();
  const readwiseReady = Boolean(
    (rw as { readwise_enabled?: boolean; readwise_verified_at?: string | null } | null)?.readwise_enabled &&
      (rw as { readwise_verified_at?: string | null } | null)?.readwise_verified_at,
  );

  return (
    <section className="space-y-3">
      {(digest.sections ?? []).length === 0 && (
        <p className="text-sm text-muted">No sources yet — add one below.</p>
      )}
      {(digest.sections ?? []).map((s: Section) => (
        <div key={s.id} className="space-y-3 rounded border border-rule bg-white/50 p-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p>
                {s.title} <span className="font-mono text-xs text-muted">· {s.kind}</span>
              </p>
              <p className="text-sm text-muted">{sectionDetail(s)}</p>
              {s.cadence && s.cadence !== "daily" && (
                <p className="font-mono text-xs text-muted">runs {cadenceLabel(s)}</p>
              )}
              {s.kind === "search" && !digest.web_search_enabled && (
                <p className="text-sm text-muted">
                  ⚠ Skipped — live web search is off for this digest.
                </p>
              )}
              {s.kind === "readwise" && !readwiseReady && (
                <p className="text-sm text-muted">
                  ⚠ Skipped — Readwise isn&apos;t connected.{" "}
                  <a href="/settings" className="underline">
                    Connect it
                  </a>
                  .
                </p>
              )}
              {s.instructions && <p className="text-sm text-muted">{s.instructions}</p>}
            </div>
            <form action={removeSection}>
              <input type="hidden" name="id" value={digest.id} />
              <input type="hidden" name="section_id" value={s.id} />
              <button type="submit" className="font-mono text-xs text-muted hover:text-ink">
                remove
              </button>
            </form>
          </div>
          <details>
            <summary className="cursor-pointer font-mono text-xs text-muted hover:text-ink">edit</summary>
            <div className="mt-3">
              <AddSectionForm digestId={digest.id} section={s} />
            </div>
          </details>
        </div>
      ))}

      {hasInbox && <InboxAddress token={digest.inbox_token ?? null} />}

      <AddSectionForm digestId={digest.id} />
    </section>
  );
}

function cadenceLabel(s: Section): string {
  if (s.cadence === "weekdays") return "on weekdays";
  const days = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  return days[s.weekday ?? 0];
}

function sectionDetail(s: Section): string {
  switch (s.kind) {
    case "search":
      return s.query;
    case "feed":
      return s.urls.join(", ");
    case "serial":
      return `book ${s.book_id}, ${s.pages_per_day ?? 1} page(s)/day`;
    case "readwise":
      return s.mode === "random"
        ? `random highlights from your ${s.category ?? "whole"} library`
        : "your Readwise daily review";
    case "ranked":
      return [
        s.source,
        s.query,
        (s.targets ?? []).join(", "),
        s.min_score ? `≥ ${s.min_score}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "inbox":
      return (s.senders ?? []).length
        ? `mail from ${(s.senders ?? []).join(", ")}`
        : "everything mailed to this digest";
    case "unread":
      return `leftovers from the corpus, ${s.min_age_days ?? 3}–${s.max_age_days ?? 30} days old`;
    case "sitewatch":
      return `${s.urls.join(", ")} — only when the page changes`;
    case "video":
      return s.channels.join(", ");
    case "quiz":
      return s.over === "today" ? "recall questions on today's issue" : "recall questions on the last issue";
    default:
      return "generated — no retrieval";
  }
}
