"use client";

import { useState } from "react";
import { addSection, updateSection } from "../actions";
import type { Section, SectionKind } from "@/lib/digest/types";

// The section form, kind-aware, doing double duty as both "add" and "edit".
//
// It used to be one flat form whose unused fields were ignored by the matching branch in addSection — fine
// at four kinds, unusable at eleven ("Book id (serial)" sitting above "Subreddits (ranked)" above "Channels
// (video)"). So the kind selector now drives which fieldset renders. The submitted FormData shape is
// unchanged, and addSection/updateSection still read only the fields their branch cares about: this is a
// progressive disclosure layer over the same contract, not a new one.
//
// Edit mode reuses the exact same fieldsets rather than a parallel read-only view, prefilled via `val()` —
// a section IS its fields, so "make it editable" means "put the add form's inputs in front of the current
// values," not a second form to keep in sync with the first.

const FIELD = "w-full rounded border border-rule bg-white px-3 py-2 text-sm";
const LABEL = "font-mono text-xs uppercase tracking-wider text-muted";
const HINT = "block text-xs text-muted";

interface KindInfo {
  value: SectionKind;
  label: string;
  blurb: string;
}

// Ordered by how often you'd reach for one, and labelled with what it COSTS to gather — the only property
// that reliably surprises people later.
const KINDS: KindInfo[] = [
  { value: "feed", label: "feed — RSS/Atom", blurb: "Fetches only. The default source." },
  {
    value: "ranked",
    label: "ranked — HN, Reddit, arXiv, GitHub, Lobsters",
    blurb: "Fetches only. These sources ship their own ranking, so the section can pick the top few instead of the newest few.",
  },
  {
    value: "inbox",
    label: "inbox — newsletters mailed to this digest",
    blurb: "No fetching at all: the sender delivers. Use the address shown above.",
  },
  {
    value: "video",
    label: "video — YouTube channels and podcasts",
    blurb: "Fetches a transcript where one exists, so an hour of video becomes a few minutes of reading.",
  },
  {
    value: "readwise",
    label: "readwise — quotes from your highlights",
    blurb: "One API call. Printed verbatim; no model touches the quote.",
  },
  { value: "serial", label: "serial — pages from one of your books", blurb: "One database read. No model." },
  {
    value: "unread",
    label: "unread — what this digest fetched and never used",
    blurb: "Free: it reads posts already in your corpus. Good weekly.",
  },
  {
    value: "sitewatch",
    label: "sitewatch — pages with no feed",
    blurb: "Fetches each page and only speaks when the text actually changed.",
  },
  {
    value: "search",
    label: "search — live web search",
    blurb: "The one paid gather path. Needs the toggle on this digest's Settings tab.",
  },
  {
    value: "quiz",
    label: "quiz — recall questions on the last issue",
    blurb: "A closer: runs after the other sections, over what you were actually sent.",
  },
  { value: "prompt", label: "prompt — no retrieval", blurb: "A reflection. Nothing is fetched or cited." },
];

// Prefill helper: reads a field by its section-object key (which is usually, but not always, the same as
// the form field name — e.g. the "ranked_source" input maps to the object's "source" property). Arrays
// round-trip through the same comma/whitespace-separated text the inputs already parse on submit.
function val(section: Section | undefined, key: string): string {
  if (!section) return "";
  const v = (section as unknown as Record<string, unknown>)[key];
  if (Array.isArray(v)) return v.join(", ");
  return v == null ? "" : String(v);
}

export function AddSectionForm({ digestId, section }: { digestId: number; section?: Section }) {
  const [kind, setKind] = useState<SectionKind>(section?.kind ?? "feed");
  const [cadence, setCadence] = useState(section?.cadence ?? "daily");
  const info = KINDS.find((k) => k.value === kind)!;

  return (
    <form
      action={section ? updateSection : addSection}
      className="space-y-3 rounded border border-dashed border-rule p-4"
    >
      <input type="hidden" name="id" value={digestId} />
      {section && <input type="hidden" name="section_id" value={section.id} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className={LABEL}>Kind</span>
          <select
            name="kind"
            className={FIELD}
            value={kind}
            onChange={(e) => setKind(e.target.value as SectionKind)}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <span className={HINT}>{info.blurb}</span>
        </label>
        <label className="block space-y-1">
          <span className={LABEL}>Title</span>
          <input
            name="title"
            className={FIELD}
            placeholder="What's new in AI writing tools"
            defaultValue={section?.title ?? ""}
          />
        </label>
      </div>

      {kind === "search" && (
        <label className="block space-y-1">
          <span className={LABEL}>Search query</span>
          <input
            name="query"
            className={FIELD}
            placeholder="AI writing tools launches and research"
            defaultValue={val(section, "query")}
          />
        </label>
      )}

      {kind === "feed" && (
        <label className="block space-y-1">
          <span className={LABEL}>Feed URLs — whitespace or comma separated</span>
          <input
            name="urls"
            className={FIELD}
            placeholder="https://example.com/feed.xml"
            defaultValue={val(section, "urls")}
          />
          <span className={HINT}>
            Several feeds in one section are read round-robin, so a daily publisher can&apos;t crowd out a
            monthly one.
          </span>
        </label>
      )}

      {kind === "ranked" && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className={LABEL}>Source</span>
              <select name="ranked_source" className={FIELD} defaultValue={val(section, "source") || "hn"}>
                <option value="hn">hn — Hacker News above a points floor</option>
                <option value="arxiv">arxiv — new papers by category (primary sources)</option>
                <option value="github">github — releases of repos you follow</option>
                <option value="reddit">reddit — top of a subreddit, last 24h</option>
                <option value="lobsters">lobsters — hottest</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className={LABEL}>Min score (hn, reddit, lobsters)</span>
              <input
                name="min_score"
                type="number"
                className={FIELD}
                placeholder="100"
                defaultValue={val(section, "min_score")}
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className={LABEL}>Query (hn, arxiv)</span>
            <input
              name="query"
              className={FIELD}
              placeholder="local-first software"
              defaultValue={val(section, "query")}
            />
          </label>
          <label className="block space-y-1">
            <span className={LABEL}>Targets — subreddits, owner/repo, or arXiv categories</span>
            <input
              name="targets"
              className={FIELD}
              placeholder="cs.CL, cs.AI  ·  anthropics/claude-code  ·  r/writing"
              defaultValue={val(section, "targets")}
            />
          </label>
        </div>
      )}

      {kind === "inbox" && (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className={LABEL}>Only from (optional) — addresses or domains, comma separated</span>
            <input
              name="senders"
              className={FIELD}
              placeholder="stratechery.com, hello@newsletter.dev"
              defaultValue={val(section, "senders")}
            />
            <span className={HINT}>Blank means everything that arrives at this digest&apos;s address.</span>
          </label>
          <label className="block space-y-1">
            <span className={LABEL}>Look back (days)</span>
            <input
              name="days"
              type="number"
              defaultValue={val(section, "days") || "2"}
              className={FIELD}
            />
          </label>
        </div>
      )}

      {kind === "video" && (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className={LABEL}>Channels — YouTube urls/@handles, or podcast RSS</span>
            <input
              name="channels"
              className={FIELD}
              placeholder="https://youtube.com/@veritasium, https://feeds.example/podcast.xml"
              defaultValue={val(section, "channels")}
            />
          </label>
          <label className="block space-y-1">
            <span className={LABEL}>Look back (days)</span>
            <input
              name="days"
              type="number"
              defaultValue={val(section, "days") || "3"}
              className={FIELD}
            />
          </label>
        </div>
      )}

      {kind === "serial" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className={LABEL}>Book id</span>
            <input name="book_id" type="number" className={FIELD} defaultValue={val(section, "book_id")} />
          </label>
          <label className="block space-y-1">
            <span className={LABEL}>Pages/day</span>
            <input
              name="pages_per_day"
              type="number"
              defaultValue={val(section, "pages_per_day") || "1"}
              className={FIELD}
            />
          </label>
        </div>
      )}

      {kind === "readwise" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className={LABEL}>Draw</span>
            <select name="readwise_mode" className={FIELD} defaultValue={val(section, "mode") || "review"}>
              <option value="review">review — Readwise&apos;s own daily pick</option>
              <option value="random">random — resurface from your library</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className={LABEL}>From (random only)</span>
            <select name="readwise_category" className={FIELD} defaultValue={val(section, "category")}>
              <option value="">everything</option>
              <option value="books">books</option>
              <option value="articles">articles</option>
              <option value="podcasts">podcasts</option>
              <option value="tweets">tweets</option>
            </select>
          </label>
        </div>
      )}

      {kind === "unread" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className={LABEL}>Skip anything newer than (days)</span>
            <input
              name="min_age_days"
              type="number"
              defaultValue={val(section, "min_age_days") || "3"}
              className={FIELD}
            />
            <span className={HINT}>Keeps this out of the way of the sections still considering those posts.</span>
          </label>
          <label className="block space-y-1">
            <span className={LABEL}>…or older than (days)</span>
            <input
              name="max_age_days"
              type="number"
              defaultValue={val(section, "max_age_days") || "30"}
              className={FIELD}
            />
          </label>
        </div>
      )}

      {kind === "sitewatch" && (
        <label className="block space-y-1">
          <span className={LABEL}>Page URLs — whitespace or comma separated</span>
          <input
            name="urls"
            className={FIELD}
            placeholder="https://example.com/syllabus"
            defaultValue={val(section, "urls")}
          />
          <span className={HINT}>Speaks only when the extracted text changes. Silence means nothing moved.</span>
        </label>
      )}

      {kind === "quiz" && (
        <label className="block space-y-1">
          <span className={LABEL}>Quiz which issue</span>
          <select name="quiz_over" className={FIELD} defaultValue={val(section, "over") || "previous"}>
            <option value="previous">the previous issue — retrieval practice</option>
            <option value="today">today&apos;s issue — a self-check at the end</option>
          </select>
        </label>
      )}

      <label className="block space-y-1">
        <span className={LABEL}>Instructions</span>
        <textarea
          name="instructions"
          rows={2}
          className={FIELD}
          placeholder="What to look for, and what to do with it."
          defaultValue={section?.instructions ?? ""}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className={LABEL}>Max items</span>
          <input name="max_items" type="number" defaultValue={section?.max_items ?? 5} className={FIELD} />
        </label>
        <label className="block space-y-1">
          <span className={LABEL}>Runs</span>
          <select
            name="cadence"
            className={FIELD}
            value={cadence}
            onChange={(e) => setCadence(e.target.value as typeof cadence)}
          >
            <option value="daily">every day</option>
            <option value="weekdays">weekdays only</option>
            <option value="weekly">once a week</option>
          </select>
        </label>
        {cadence === "weekly" && (
          <label className="block space-y-1">
            <span className={LABEL}>On</span>
            <select name="weekday" className={FIELD} defaultValue={String(section?.weekday ?? 0)}>
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, n) => (
                <option key={d} value={n}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <button type="submit" className="rounded border border-ink px-4 py-2 font-mono text-sm">
        {section ? "Save changes" : "Add section"}
      </button>
    </form>
  );
}
