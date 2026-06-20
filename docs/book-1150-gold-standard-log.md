# Book 1150 "mastering freedom" — gold-standard log

Living log for driving ONE book to full brief conformance, used as the proving ground for the Story
Studio architecture. Framework: `can-i-generate-a-better-book.md`. Mechanism: `brief-mandate-propagation.md`.

**Goal:** get 1150 to deliver its brief at gold standard — a *Romantic Ecchi Comedy*, explicit, ~25k
words, "scintillating, oxytocin releasing, turning on," that stays funny throughout.

---

## The brief (the target)

| Field | Value |
|---|---|
| genre | Romantic Ecchi Comedy |
| content_type | **explicit** (`{level:"explicit"}`) — set 2026-06-20 |
| tone | playful, warm, urgent |
| scope | novella, **word_target 25,000** |
| success_criteria | page turner, scintillating, oxytocin releasing, turning on |
| audience | any horny free thinker |
| premise | slave/master; master once slept with her mother; she's strong, paradoxical; he's bold, greedy yet kind |

Foundations: voice_exemplar **pinned** (the "plucked hen" horse-joke sample — excellent, wry close-third);
art_theme `comic`; 38 tentpoles (fluid/pinned/killed); ending + argument pinned.

---

## Current state (2026-06-20) — MIXED, do not trust the manuscript

| Rung | State | Notes |
|---|---|---|
| brief | ✅ fixed | content_type=explicit now set; MANDATE mechanism live |
| foundations | ✅ rich | strong cast/voice; 38 tentpoles carry the heat+comedy DNA |
| spine | 🟡 regenerated 13:16 | tight bones, but launders heat→euphemism + drops comedy (see Iteration 2) |
| objectives | ⬜ stale | predate the new spine |
| beats | ⬜ stale | the OLD beats authored the fade-to-black (pg23 "the threshold of it") |
| **prose** | ❌ OLD/pre-fix | the 27-page manuscript = the fade-to-black, 12.3k-word draft. NOT regenerated through the fix. |

**Key fact:** the manuscript on disk is the *pre-fix* draft. The mechanism fix (C1–C4) and content_type
are in place but the book **has not been regenerated through them yet.** Any gold-standard run starts by
regenerating beats→prose. Until then the gate scores the old draft, not the fixed pipeline.

---

## Scorecard (vs brief)

Measured on the current/old manuscript via the mandate gate (`/tmp/verify_gate.mjs`, 2026-06-20):

| Axis | Verdict | Evidence |
|---|---|---|
| Length | ❌ FAIL | 12,350 / 25,000 (49%) |
| Heat | ❌ FAIL | "consummation laundered to a subordinate clause"; nude inspection has zero body description |
| Genre/comedy | 🟡 PARTIAL | funny in Parts I–II, abandons comic register in III–IV; ecchi absent throughout |
| Success | 🟡 PARTIAL | oxytocin/page-turn partial; "scintillating"/"turning on" NOT delivered |
| Craft | ✅ strong | excellent voice, drawer/ledger controlling metaphor, real value-turns & payoffs |
| Coherence | 🟡 | stale spine routes cite ≥9 deleted + 1 killed tentpole id (referential rot) |

**Overall: FAIL** — strong craft, but misses the three things the brief is most about.

---

## What worked

- **The MANDATE mechanism carries heat at beat/prose (PROVEN).** A/B on a held context+objective: the
  new VOICE+MANDATE prompt produced explicit, on-page consummation (fade 1→0, on-page markers 2→5),
  2.2× length, comedy preserved — vs the old "voice contract" prompt that faded to black. (`/tmp/verify_heat.mjs`)
- **The conformance gate independently reproduces the hand diagnosis** (length/heat FAIL, genre/success
  PARTIAL, with quotes). Trustworthy backstop.
- **content_type plumbing is live** — explicit set, brief_hash updated, derives the heat MANDATE.
- **The tentpole bank is gold** — the heat (wash-room, cup-to-throat, hut) and comedy (horse joke,
  Wenna steering Cassian, pear argument) DNA is all there; the selected route still carries it.

## What didn't (open problems)

1. **Spine layer still launders.** Even regenerated against the explicit brief, the spine `text`
   euphemizes heat ("fall into each other") and drops comedy entirely — though the underlying routes
   carry both. So spine→text compression is a *second* laundering point the mechanism fix hasn't closed.
   → Hypothesis: spine generation needs the same anti-launder scrutiny, OR the route→text selection/edit
   step lost it. Next: steer a spine regen toward "heat as recurring engine + restore comic texture" and
   A/B against the current text.
2. **The book hasn't been regenerated through the fix.** Prose is still pre-fix. Can't claim any
   improvement until beats→prose are re-run with content_type=explicit + per-page budget live.
3. **Length undershoot unproven-fixed.** C4 injects per-page budgets but no full-book regen has confirmed
   the 25k lands. Risk: per-page targets met but climax still starved (flat allocation).
4. **Referential rot in spine routes** — `tentpole_order` cites deleted/killed ids. Cosmetic now,
   could misfire a future route-driven regen. Low priority.

---

## Iteration log

### Iteration 0 — baseline diagnosis (2026-06-20)
Read the full pre-fix book + foundations. Found: brief broke on heat (fade-to-black), length (49%),
comedy (drift). Root-caused to the brief being injected as "the voice contract." → led to C1–C5 + gate.

### Iteration 1 — mechanism fix (C1–C5) shipped
VOICE/MANDATE split, anti-launder in compression, per-page length, content_type axis, conformance gate.
Committed `4f771d9`..`348e505`. Proven via A/B that beat/prose now carry heat. **Not yet applied to 1150's
prose.**

### Iteration 2 — spine inspection (2026-06-20)
Regenerated spine reads as strong *literary romance*, not *ecchi comedy*: heat euphemized, comedy absent
from the `text` though present in the routes. Verdict: B+ structurally, under-sells the two defining
promises. → open problem #1.

### Next planned iteration
Regenerate 1150 end-to-end through the fixed pipeline (beats→prose with content_type=explicit), then run
the gate. First real test of whether the mechanism produces a gold-standard *book*, not just a gold-standard
*page*. Decide spine-laundering fix (problem #1) before or after — likely fix the spine first since prose
inherits from it.

---

## Definition of done (gold standard for 1150)
Gate returns **PASS on every axis**: length 85–115% of 25k, heat PASS (explicit, on-page, recurring),
genre PASS (funny throughout AND ecchi present), success PASS ("turning on" delivered) — with craft and
coherence intact. At that point 1150 is the reference book and the architecture is validated.
