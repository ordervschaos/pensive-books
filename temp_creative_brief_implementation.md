# Creative Brief — Implementation Summary

Built the v1 feature exactly per `temp_creative_brief_plan.md`. Form-first
intake stored as a JSONB column, with a post-create stepper and a
permanent edit surface.

## What ships

- **DB:** `books.brief jsonb` (nullable). Hidden from readers at the
  application layer by omitting the column from reader queries.
- **Post-create stepper** opens after the user saves their new book. Six
  steps — scope, genre, audience, premise, tone, success criteria. Each
  step is skippable and auto-persists, so closing the dialog mid-way
  keeps partial answers.
- **Permanent Creative Brief card** on `/books/:slug/edit`. Collapsible.
  Defaults open if the brief is empty. Single Save button at the bottom.
- **Author-only nudge** on `/books/:slug` when the brief is empty or
  <3 fields filled. Dismissable per book via localStorage.

## Files

### New
- `supabase/migrations/20260521010000_add_brief_to_books.sql`
- `apps/web/src/lib/brief.ts` — `Brief` type, suggestions, completion
  helper, `mergeBrief`, `scopeSummary`, `briefToPromptContext`.
- `apps/web/src/components/book/BookBriefSection.tsx` — edit-page card.
- `apps/web/src/components/book/BriefIntakeSheet.tsx` — post-create
  stepper.

### Modified
- `apps/web/src/pages/books/new/NewBook.tsx` — opens the intake sheet
  after the insert; navigation to the book now happens when the sheet
  closes (Finish, Skip-through, or dismiss).
- `apps/web/src/pages/books/edit/BookEdit.tsx` — renders the
  `BookBriefSection` between the form and the Danger Zone.
- `apps/web/src/pages/books/show/BookDetails.tsx` — adds the
  author-only nudge below `<BookInfo>`.
- `apps/web/src/hooks/use-page-view-data.ts`,
  `apps/web/src/utils/pagePreloader.ts`,
  `apps/web/src/pages/books/flashcards/BookFlashcards.tsx`,
  `apps/web/src/pages/invitation/JoinBook.tsx` — switched their
  `select("*")` to explicit column lists so the `brief` column never
  ships to non-authoring surfaces.

## Brief shape (v1)

```ts
type Brief = {
  scope?: { band?: "short"|"novella"|"novel"|"epic"|"custom"; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
  updated_at?: string;
};
```

## Not done (deliberately)

- **Public column-mask view.** The marketing site already uses explicit
  column lists, so `brief` doesn't ship to anonymous readers. Inside the
  authenticated app, a view-only collaborator may still receive `brief`
  via `BookDetails`/`BookEdit`. Tightening that further (e.g. a
  `books_for_readers` view) is deferred — the brief isn't sensitive
  data and is never rendered to viewers.
- **Templates / presets** (novella, memoir, etc).
- **Versioning** of the brief.
- **Guided AI intake chat** — phase 2 will read/write the same JSON via
  tool calls; no schema change needed.

## Verification

- `pnpm typecheck` — passes.
- `pnpm lint` — 0 errors, 23 pre-existing warnings unrelated to this
  change.
- No browser smoke test was run; recommend manually verifying:
  1. `/books/new` → save → intake dialog appears, autosaves on each
     Next, closes to `/books/:slug`.
  2. `/books/:slug/edit` → Creative brief card renders, saves merge
     correctly, completion meter updates.
  3. `/books/:slug` → nudge appears when brief empty, dismiss persists.
