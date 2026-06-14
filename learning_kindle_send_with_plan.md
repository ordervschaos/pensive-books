# Learning: Send to Kindle "with plan" (admin)

Feature: admin-only Kindle export that embeds each page's **objective** and **beat** above its prose, so the whole book ships to Kindle as an annotated manuscript.

## Named concepts

- **EPUB (Electronic PUBlication)** — a zip of XHTML + CSS + an OPF manifest that e-readers render. Here built client-side with JSZip in `lib/epub.ts`; `content.xhtml` holds every page concatenated as `<section>`s. The plan block is just extra XHTML injected before each page's `.page-content`.

- **OPF manifest / NCX / nav.xhtml** — the EPUB's three tables of contents (package manifest, legacy NCX, modern nav). Untouched here; the plan rides inside existing page sections, so no TOC changes were needed.

- **jsonb metadata column** — Postgres `jsonb` on `pages` storing loosely-typed authoring data. `metadata.objective` (page's job) and `metadata.beat` (one paragraph: what the page does to fulfil it) live here. "Beats" plural in the request = this single `beat` field per page; the plural `beats` elsewhere is a book-level journey key, unrelated.

- **Flag threading (parameter drilling)** — passing one boolean `includePlan` down a call chain rather than branching at each layer: `BookInfo.handleSendToKindle(true)` → `generateAndDownloadEPUB({includePlan})` → `generateEPUB(...,includePlan)` → `generateContentXhtml(...,includePlan)`. Each layer just forwards; only the leaf renders differently.

- **Feature gate (UI-level)** — `useAdmin()` hook checks the `admin_users` table; the extra dropdown item renders only when `isAdmin`. Chosen over a server gate because the data is the user's own book sent to their own verified Kindle — no privilege escalation, so the gate is product-scoping, not security.

- **OTP-verified send chain (pre-existing)** — `get-kindle-token` edge fn hands the client a Mailgun token; client POSTs the EPUB as an email attachment to the user's `kindle_email` (unlocked earlier via `send-kindle-verification` + `verify-kindle-otp`). The new feature reuses this verbatim; only the attachment content + title differ.

## The system (stakeholders / parts)

- **Author/admin** clicks "Send to Kindle (with plan)" in the Export dropdown (`BookInfo.tsx`).
- **EPUB generator** (`lib/epub.ts`) reads `page.metadata` → renders an `<aside class="page-plan">` with Objective + Beat labels, styled by `.page-plan` CSS.
- **Mailgun** delivers the `.epub` (titled `"<name> (with plan)"` so it doesn't overwrite the clean copy on the device).
- **Kindle** receives a manuscript where every chapter opens with its planning notes.

## Files touched

- `apps/web/src/lib/epub.ts` — `readPagePlan` + `renderPagePlan` helpers; `includePlan` param on `generateContentXhtml` and `generateEPUB`; `.page-plan` CSS.
- `apps/web/src/lib/download.ts` — `includePlan` on `DownloadOptions`, forwarded to `generateEPUB`.
- `apps/web/src/components/book/BookInfo.tsx` — `useAdmin` gate, `handleSendToKindle(includePlan)`, distinct title/filename, admin-only menu item.
