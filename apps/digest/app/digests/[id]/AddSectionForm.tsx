"use client";

import { useState } from "react";
import { addSection, updateSection } from "../actions";
import type { Section, SectionKind } from "@/lib/digest/types";
import { fieldsFor, fieldValue, isRequired, type Field } from "@/lib/digest/sectionSchema";

// The section form, doing double duty as both "add" and "edit". It renders whatever
// `lib/digest/sectionSchema.ts` declares for the chosen kind, and knows nothing about any individual kind.
//
// Two rewrites got it here. First it was one flat form whose unused fields were ignored by the matching
// branch in addSection — fine at four kinds, unusable at ten ("Min score (ranked)" sitting above
// "Subreddits (ranked)" above "Channels (video)"). Then it was a hand-written fieldset per kind, which fixed
// the noise but left the field list duplicated across here, `types.ts` and the parse branch in `actions.ts`:
// three edits per new field, and silent drift the moment you forgot one.
//
// Now the schema is the single declaration and this file is a renderer. Required-ness is MARKED here and
// ENFORCED in the action — the asterisk is a courtesy, not the check.
//
// Edit mode reuses the same inputs rather than a parallel read-only view — a section IS its fields, so
// "make it editable" means "put the form in front of the current values," not a second form to keep in sync.

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

export function AddSectionForm({ digestId, section }: { digestId: number; section?: Section }) {
  const [kind, setKind] = useState<SectionKind>(section?.kind ?? "feed");
  const [cadence, setCadence] = useState(section?.cadence ?? "daily");
  // Live copy of the kind's field values, so `requiredWhen` can be reflected as you type — the "Targets"
  // field marks itself required the moment you pick arxiv, rather than only on a rejected submit.
  const [values, setValues] = useState<Record<string, string>>({});
  const info = KINDS.find((k) => k.value === kind)!;
  const fields = fieldsFor(kind);

  // Reading a field's current value: what's been typed this session, else what's saved, else its default.
  const current = (field: Field) => values[field.name] ?? fieldValue(section, field);

  return (
    <form
      action={section ? updateSection : addSection}
      className="space-y-3 rounded border border-dashed border-rule p-4"
    >
      <input type="hidden" name="id" value={digestId} />
      {section && <input type="hidden" name="section_id" value={section.id} />}

      <label className="block space-y-1">
        <span className={LABEL}>Kind</span>
        <select
          name="kind"
          className={FIELD}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as SectionKind);
            setValues({}); // a different kind has different fields; carrying stale ones over is noise
          }}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <span className={HINT}>{info.blurb}</span>
      </label>

      {/* Every field this kind has, rendered from ONE declaration in lib/digest/sectionSchema.ts. Adding a
          field to a kind is an edit there and nowhere else — this component never learns kind names. */}
      {fields.map((field) => {
        const required = isRequired(field, resolved(fields, current));
        return (
          <label key={field.name} className="block space-y-1">
            <span className={LABEL}>
              {field.label}
              {required ? <span className="text-ink"> *</span> : <span className="normal-case"> — optional</span>}
            </span>

            {field.type === "select" ? (
              <select
                name={field.name}
                className={FIELD}
                value={current(field)}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              >
                {field.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={field.name}
                type={field.type === "number" ? "number" : "text"}
                className={FIELD}
                placeholder={field.placeholder}
                value={current(field)}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              />
            )}

            {field.hint && <span className={HINT}>{field.hint}</span>}
          </label>
        );
      })}

      <label className="block space-y-1">
        <span className={LABEL}>
          Instructions<span className="normal-case"> — optional</span>
        </span>
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

// `requiredWhen` reads a sibling's value, so it needs the whole set, not one field at a time.
function resolved(fields: readonly Field[], current: (f: Field) => string): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.name, current(f)]));
}
