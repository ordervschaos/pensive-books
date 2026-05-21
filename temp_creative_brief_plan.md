# Creative Brief — Author Intention Capture

A scaffolding feature that lets the author optionally answer a small set of
intent-setting questions when creating a book. Hidden from end readers.
Used by the author as a thinking tool now, and later fed into AI features.

## Decisions locked in
- **Storage:** JSONB column `books.brief`. Iterate without migrations; promote
  individual fields to typed columns later if querying needs grow.
- **Intake UX:** optional sheet after "Save & start writing" on `/books/new`,
  plus a permanent editable card on `/books/:slug/edit`.
- **Visibility:** editors and owner see the brief; readers never do. Inherits
  the existing `books` RLS — no new policy needed.

## The brief shape (v1)

```ts
type Brief = {
  // 1. Approximate scope. Band first, optional numeric target.
  scope?: {
    band?: "short" | "novella" | "novel" | "epic" | "custom";
    word_target?: number; // populated for "custom" or refining a band
  };
  // 2. Genre / shelf. Free text + suggestion chips.
  genre?: string;
  // 3. Audience. One-line "who is this for?".
  audience?: string;
  // 4. Premise / logline. 1–2 sentences. The most valuable field for AI feed.
  premise?: string;
  // 5. Tone. Multi-select chips + free text.
  tone?: string[];
  // 6. Success criteria. Free text.
  success_criteria?: string;
  // Bookkeeping (not user-facing fields)
  updated_at?: string; // ISO timestamp
  completed_steps?: number; // how many of the 6 fields are filled
};
```

Stored as `books.brief jsonb` — NULL until the author opens the intake.

### Why these six questions
- **Scope band** is concrete and easy to pick. A band is enough to coach a
  writer ("you're 40% through your novella target").
- **Genre** sets stylistic expectations for any future AI suggestions.
- **Audience** is the single most useful tone-setter for revision and copy.
- **Premise** is the highest-signal field for any LLM prompt — a logline
  carries more than a genre tag.
- **Tone** captures voice intent without forcing a single label.
- **Success criteria** is the author's own definition of done. Doubles as
  the motivational anchor on slow days.

All six are optional and independently editable.

## Database

### Migration

```sql
-- supabase/migrations/YYYYMMDDHHMMSS_add_brief_to_books.sql
ALTER TABLE public.books
  ADD COLUMN brief jsonb;

COMMENT ON COLUMN public.books.brief IS
  'Author-only creative brief (intention, genre, premise, tone, etc). Hidden from readers. See temp_creative_brief_plan.md for shape.';
```

### RLS
- **Read:** already covered. `books` SELECT policy allows owner + editors +
  readers; we expose `brief` to readers only via the public site, where we
  must explicitly omit the column in selects (see "Reader-side hiding"
  below). No new policy.
- **Write:** the existing `enable_update_for_owners_and_editors` policy
  covers editors. Owner update is already allowed.

### Reader-side hiding
RLS lets readers SELECT the row but it doesn't column-mask. We need every
reader-facing query to omit `brief`. Two safe paths:

1. **Explicit column lists in reader queries.** Audit `BookDetails`,
   `PageView`, the public-site fetches, and any public RPCs. Cheap and
   clear. Use this for v1.
2. **A view `public_books`** that excludes `brief`, used by all reader
   queries. Cleaner long-term but a larger change. Defer.

Action: grep for `from("books").select("*")` and replace with explicit
column lists where the result reaches a reader. Author/editor surfaces
can continue to use `select("*")`.

## UI

### A. Post-create intake sheet

Triggered from `apps/web/src/pages/books/new/NewBook.tsx` immediately after
the existing `navigate(`/books/${data.id}`)`. Instead of navigating straight
to the book, open the sheet first; navigation happens on Skip or Finish.

Component: `apps/web/src/components/book/BriefIntakeSheet.tsx`

Layout — stepper, one card per question, six steps:

```
┌──────────────────────────────────────────────┐
│  Step 2 of 6 · skip this →            ✕ close │
│                                              │
│  Genre or shelf                              │
│  ────────────────────────────────────────    │
│  Where would this sit on a shelf?            │
│                                              │
│  [ literary fiction ] [ memoir ] [ mystery ] │
│  [ self-help ] [ sci-fi ] [ poetry ] [ + ]   │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ Or type your own…                      │  │
│  └────────────────────────────────────────┘  │
│                                              │
│        [ Skip this ]   [ Next  → ]           │
└──────────────────────────────────────────────┘
```

Behaviour:
- Progress dots at top (six). Filled = answered. Outline = skipped/empty.
- Every step has **Skip this** (records `null`, advances) and **Next**.
- Final step is **Finish** which writes the full `brief` object to the row.
- Closing the sheet via ✕ persists what's been entered so far. Same JSON
  write, just abandoned mid-way.
- After Finish/Skip, navigate to `/books/:slug`.

Visual language: match `NewBook.tsx` typography (`pv-display`, `pv-serif`,
`pv-eyebrow`). Reuse the same `Field` pattern and the `Dialog`/`Sheet`
primitives already in `components/ui/`.

### B. Permanent edit surface

In `apps/web/src/pages/books/edit/BookEdit.tsx`, add a section between
`BookEditForm` and the Danger Zone:

```
┌─────────────────────────────────────────────────┐
│  Creative brief                          edit ▾ │
│  ─────────────────────────────────────────────  │
│  Your scaffolding — never shown to readers.     │
│                                                 │
│  Scope         · Novella (≈25,000 words)        │
│  Genre         · Literary fiction               │
│  Audience      · Anyone who's moved cities      │
│                  in their 30s                   │
│  Premise       · A translator returns home      │
│                  for a funeral and gets stuck.  │
│  Tone          · warm · biting · lyrical        │
│  Success       · I publish it. I'm proud of it. │
│                                                 │
│  3 of 6 filled · last updated 2 days ago        │
└─────────────────────────────────────────────────┘
```

Component: `apps/web/src/components/book/BookBriefSection.tsx`
- Reuses the same per-field editor components as the intake sheet, but
  rendered inline (no stepper). Click a row to expand into edit mode for
  that field, save on blur or with a Done button.
- Empty fields show a subtle "Add…" link, not a placeholder value.
- Completion meter at the bottom is a quiet nudge.

### C. Subtle nudge on book details (author-only)

On `/books/:slug` (the `BookDetails` page) for the author/editor only: if
`brief` is null or `completed_steps < 3`, show one small line near the
masthead:

> *Want to set this book's intention? — `Open the brief →`*

Hide it once dismissed (localStorage flag per book) or once
`completed_steps >= 3`. Never shown to readers.

## Data flow

1. **Create:** `NewBook` inserts into `books` (existing fields). On success,
   stash `bookId`, open `BriefIntakeSheet` instead of navigating.
2. **Each step:** local state only. Optionally autosave the partial brief
   every step so closing mid-way doesn't lose data.
3. **Finish:** single `update books set brief = $1 where id = $2`.
4. **Edit later:** field-level updates from `BookBriefSection`. Each save
   merges into the current `brief` JSON (read-modify-write since Supabase
   client doesn't do jsonb_set on the wire; do it in app code).

## Reusable for the future chatbot

When phase 2 adds the guided-intake chat:
- The chat (an LLM with a small tool surface) reads the same `brief`
  field, asks for the missing pieces conversationally, and writes back
  via the same `update` shape.
- Already-filled fields are skipped or only revisited if the author asks.
- The chat lives at `/books/:slug/brief/chat` (new route) and is a sibling
  of the form, not a replacement.

When AI features (suggestions, revisions, generation) want context, they
read `books.brief` and prepend it to the system prompt:

> *This book is a {scope.band} ({scope.word_target} words target),
> genre: {genre}, for: {audience}. Premise: {premise}. Tone:
> {tone.join(", ")}. The author considers it done when:
> {success_criteria}.*

## Files to touch

New:
- `supabase/migrations/YYYYMMDDHHMMSS_add_brief_to_books.sql`
- `apps/web/src/components/book/BriefIntakeSheet.tsx`
- `apps/web/src/components/book/BookBriefSection.tsx`
- `apps/web/src/lib/brief.ts` — Brief type + helpers (`computeCompletion`,
  `mergeBriefField`, `briefToPromptContext`).

Modified:
- `apps/web/src/pages/books/new/NewBook.tsx` — open sheet after save
  instead of navigating immediately.
- `apps/web/src/pages/books/edit/BookEdit.tsx` — add `<BookBriefSection>`.
- `apps/web/src/pages/books/show/BookDetails.tsx` — author-only nudge.
- Any public/reader `from("books").select("*")` — replace with explicit
  column lists that omit `brief`.

## Open questions for later (not blocking v1)

- **Templates.** Should we ship presets (a novella template, a memoir
  template) that pre-fill several fields? Likely yes in v1.5.
- **Versioning.** The brief evolves. Worth tracking history? Probably not
  in v1; `updated_at` is enough.
- **Public showcase.** Some authors might *want* to publish their brief
  (a "manifesto" page). Out of scope; revisit later with a per-field
  visibility flag.

## Implementation order (when we build it)

1. Migration — add `brief jsonb`.
2. `lib/brief.ts` — type + helpers.
3. `BookBriefSection` (edit-page card) — simpler than the sheet, gets
   the read/write paths working first.
4. `BriefIntakeSheet` — reuses the field editors from step 3.
5. Wire sheet into `NewBook`.
6. Author-only nudge on `BookDetails`.
7. Audit reader queries; switch to explicit column lists.
