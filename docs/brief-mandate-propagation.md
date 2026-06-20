# Brief → Mandate propagation (closing the conformance gap at the source)

**Status:** C1–C4 IMPLEMENTED in working tree (not committed, not deployed) as of 2026-06-20.
Gate (a) backstop still pending. Runtime end-to-end verification (regenerate a high-heat book in
dev, confirm no fade-to-black) still pending — this is the real proof; typecheck/parse only so far.
**Origin:** book 1150 "mastering freedom" shipped a craft-strong manuscript that broke its
brief on three axes — heat, length, comedy. Root-caused to the generation mechanism, not the
output. This doc fixes the mechanism so the miss can't happen; a post-hoc conformance gate
(the original "(a)") becomes a cheap backstop on top, not the primary defense.

---

## 1. Symptom (book 1150)

| Brief asked | Delivered |
|---|---|
| `genre: "Romantic Ecchi Comedy"`, `success_criteria: "scintillating … turning on"` | Fade-to-black at the first kiss; sex tentpoles `47eb9993` / `389e6545` softened to nothing |
| `scope.word_target: 25000` (novella) | ~12,350 words — half |
| `tone: [playful, warm, urgent]`, `art_theme: comic` | Funny in Parts I–II, drifts to earnest lyric by III–IV |

What propagated *perfectly*: the voice (wry close-third, the drawer/ledger metaphor). That is
the tell — see §2.

## 2. Root cause: the brief is structurally demoted to "voice"

Every generation stage injects the brief, but labels it **"the voice contract"**:

- `supabase/functions/_shared/beat-core.ts:179`
- `supabase/functions/_shared/generate-unit-core.ts:609`
- (and the spine/objective/revise stages, via `briefContext`)

And the voice exemplar is tagged *"a stronger style anchor than any instruction"*
(`generate-unit-core.ts`). So the model is **told to read the brief as voice guidance**.
Result: the *voice* attributes (register, cadence, metaphor) ship perfectly; the
*non-voice mandates* (heat, comedy intensity, length) are consumed as flavor and evaporate.

### Three concrete leaks

**L1 — Label demotion (kills heat + comedy).**
Authority flows through (a) the voice exemplar, ranked above "any instruction," and (b) the
derived chain. The brief's content mandates never get foreground authority anywhere.

**L2 — Lossy relay, no carrier (kills the spicy specifics).** Each compression hop sanitizes:

```
tentpole:  "passionate sex" / "hand to throat"
   ↓ spine-to-objectives
spine.text: "The rain; the last pretense with it"
   ↓ objective-to-beat
beat (pg23): "Close not on aftermath but on the threshold of it."
   ↓ beat-to-prose
prose:     fade to black
```

The fade-to-black was authored at the **beat**, three stages upstream of where you'd look.
It softens because (a) the compression prompts are never told these specifics are load-bearing,
and (b) **there is no `heat`/intensity field in the data model** (grep: none) — nothing to pin
"this set-piece is explicit" to, so it lives only in free text that compression abstracts away.

**L3 — No length budget (kills word count).**
`word_target: 25000` lives only in `brief.scope`. Rendered as "≈25000 words" *only* where
`scope:"full"` (spine/foundations stages). The **prose writer gets `scope:"band"`** — it sees
"novella," never the number. Nothing decomposes 25k into per-page budgets or tracks a running
total. `wordCount()` in the prose core is used for logging only, never as a target. Pages land
at ~500 words each; 22 pages → 12k.

## 3. The fix: split the brief into VOICE vs MANDATE, carried verbatim + foregrounded

Stop treating the brief as one undifferentiated "voice contract." At every generation stage,
render two blocks, both **un-derived** (verbatim from the brief, never re-compressed):

- **VOICE** (how it sounds): exemplar + `tone`. Keep the "stronger than any instruction"
  framing — it works.
- **MANDATE** (what it must deliver — non-negotiable): `genre`, `success_criteria`, `heat`,
  and the length budget. Framed as hard constraints ("the book fails if these aren't delivered").

### Change set

**C1 — Re-label + promote (no schema change).**
- `supabase/functions/_shared/brief.ts`: add a `mandate` render mode (or a second exported
  renderer `mandateContext`) that emits a titled `MANDATE (non-negotiable …)` block from
  `genre` + `success_criteria` + `heat` + scope, distinct from the voice/tone block.
- Update call sites that currently say `BRIEF (the voice contract)` to emit **both** blocks:
  `beat-core.ts:179`, `generate-unit-core.ts:609`, and the spine/objective builders.
- Fixes: L1 (heat + comedy authority).

**C2 — Anti-launder instruction in the compression stages.**
- `spine-to-objectives/index.ts` and `objective-to-beat` (`beat-core.ts`): add to the system
  prompt — *"Preserve the brief's content mandates (heat, comedy, set-piece explicitness)
  verbatim. The derived layer must be at least as committed as its source — never softer,
  never more abstract."*
- Fixes: L2 (the relay stops sanitizing).

**C3 — Add a `heat` axis to the data model.**
- New field next to `art_theme` (candidate homes: `brief.heat` or `foundations.register`).
  Small enum + free-text note, e.g. `{ level: "closed" | "warm" | "explicit", note?: string }`.
- Surface a dial in the Brief modal UI (`apps/web` — see
  `docs/learning_studio_tab_brief_modal.md`).
- Carried verbatim in the MANDATE block (C1) at every stage.
- Fixes: L2 durably (gives the specifics a typed slot that compression can't drop).

**C4 — Length budget carrier.**
- Decompose `word_target` → per-page target (total / page count, or weighted by beat
  importance for a non-flat allocation — climax pages get more).
- Inject the per-page target into the **beat** and **prose** prompts; the prose writer must
  receive the number (stop stripping it to `scope:"band"` for prose).
- Surface running total vs target so later pages can self-correct.
- Fixes: L3.

## 4. Stage-by-stage propagation table (target state)

| Stage | File | VOICE | MANDATE | Length target |
|---|---|---|---|---|
| foundations | `_shared/foundations-core.ts` | ✓ | ✓ | n/a |
| spine | `spine-to-objectives` (gen path) | ✓ | ✓ + anti-launder | total |
| objective→beat | `_shared/beat-core.ts` | ✓ | ✓ + anti-launder | per-page |
| beat→prose | `_shared/generate-unit-core.ts` | ✓ (exemplar) | ✓ **(new)** | per-page **(new)** |
| revise | `_shared/revise-core.ts`, `revision-chat.ts` | ✓ | ✓ | per-page |

## 5. Bridge-mirror tax (do not skip)

Every change above must land in **both** the edge functions **and** the dev bridge
`scripts/eval-bridge.mjs` (which reimplements the whole pipeline for dev — see
`[[project_dev_bridge_mirror]]`), plus web types. The bridge already mirrors `briefContext`
at ~20 call sites (e.g. `eval-bridge.mjs:1234, 2040, 2249`). Checklist per change:
- [ ] edge `_shared` + per-fn
- [ ] `scripts/eval-bridge.mjs`
- [ ] `apps/web/src/lib/brief.ts` (web-side Brief type + `briefToPromptContext`)
- [ ] Brief modal UI for any new field (C3)

## 6. Why this beats a gate alone

A gate scores the finished manuscript against `success_criteria` and re-rolls on a miss —
expensive, and it fights a pipeline that is actively laundering the mandate out. The mechanism
fix makes heat/length/comedy travel *with authority*, so conformance is the default. Keep the
gate as a backstop (it also catches model refusals on explicit beats — detect "beat called for
X, prose delivered ¬X"), but build it **after** C1–C4, sized to confirm rather than enforce.

## 7.5 QUEUED — C5: reframe Heat (AI dial) → Content type (publishing-first, AI-derived)

C3 shipped the heat axis framed around the AI ("Heat — how explicit may the prose be? Controls
what AI generates on the page"). That is backwards: the brief is the **human-authored, non-AI-first
contract**. Reframe so the field is a **content type / rating** an author/publisher understands on
its own terms, and the AI heat-level becomes a value **derived** from it.

One field, **two consumers**:
1. **Publishing gate** (primary, non-AI): the book's maturity classification drives marketplace
   age-gating, content warnings, and filtering — meaningful with or without AI generation. Wire it
   into the publish flow (see `[[project_publish_revalidation]]`).
2. **AI generation** (derived): `mandateContext` derives the explicitness instruction FROM the
   content type, instead of storing an AI-centric "heat."

Deltas from the current C3 implementation:
- Rename `brief.heat` → `brief.content_type` (or `content_rating`). Keep round-tripping in the
  `brief` jsonb (still no migration). Decide whether values stay `closed | warm | explicit` (framed
  as content classification) or adopt publishing-standard rating labels.
- Relabel the UI section "Heat" → "Content type"; change the subtitle from the AI framing
  ("Controls what AI generates") to publishing-first ("How mature is this book? Sets the
  marketplace rating and what may appear on the page"). The optional caveat field stays.
- Move the level→sentence mapping so `mandateContext` (edge + bridge) *derives* the heat sentence
  from `content_type` — "heat is a derived value," not a stored AI dial.
- New, separate consumer: surface `content_type` in the publishing/marketplace gate.

## 7. Suggested build order

1. **C1 + C2** together — pure prompt/renderer change, no schema, fixes heat + comedy. Validate
   by regenerating 1–2 pages of a high-heat brief and confirming the beat no longer fades.
2. **C4** — length carrier, independent, fixes the word-count miss.
3. **C3** — heat axis + UI, the durable typed slot; lands last because it touches schema + web.
4. Gate (a) as backstop.
