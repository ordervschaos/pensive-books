# The logline anatomy — generation prompt + evaluation lint

## 0. Where this sits

The **seed** is the top rung of a book's DNA tree (`seed → premise → pillar → act → beat → scene → prose`).
Its one field is `content.logline`. Everything below is drawn from it, so if the logline is a *situation*
instead of a *story*, every downstream rung inherits the weakness. This task hardened the two places that
touch the logline as *craft*, not just as data:

| Stage | Where | What it does |
|---|---|---|
| **Generation** | `supabase/functions/dna-expand/index.ts` → `target === "logline"` | LLM forges the raw idea into a 5-part logline. |
| **Evaluation** | `apps/web/.../novelDna.ts` + `supabase/functions/_shared/novel-dna.ts` → `verticalLints()` | Two deterministic lints score the result. |

These are the two halves of a **generate → verify** loop: one prompt writes the logline, one pure function
grades it. (The same shape you already run for the beat sheet's lint-then-repair, and for the synopsis read's
`craft_flag`.)

## 1. What a logline is, in one sentence

A **logline** is the one-or-two-sentence pitch that sells the *engine* of a story — not its meaning. It is the
lowest-resolution contract the whole book conforms to.

## 2. Why it matters here

The system's failure mode (see `project_brief_premise_logline`) is conflating the author's **raw idea** with a
real logline. `migrateToDna.ts` literally seeds `logline = briefIdea(brief)` — a raw premise, often a
*situation* ("a woman deals with loss"). If nothing sharpens or flags that, the premise, pillar, and beats all
elaborate a weak spine. The generation prompt is the *sharpener*; the lints are the *smoke alarm* that tells the
author (or the auto-accept agent) the seed still reads flat.

## 3. The anatomy (the craft the code now encodes)

A working logline names **five things**, concretely:

1. **Protagonist** — by *trait or role*, never a name. "A disgraced surgeon" carries information; "Sarah" carries none.
2. **Inciting incident** — the event that upends their world.
3. **Goal** — what they must now *actively* do.
4. **Obstacle / antagonist** — what stands in the way.
5. **Stakes** — what is lost on failure (life-or-death, or emotional/social — but *felt*).

Working shape: **"When [inciting incident], a [flawed protagonist] must [goal] or else [stakes] — but [obstacle]."**

> *Jaws:* "When a great white terrorizes a beach town, a water-phobic sheriff must hunt it down before it kills
> again — against a mayor who wants the beaches open."

What separates strong from flat:

- **Irony** — the protagonist's trait rubs against the task (*water-phobic* sheriff hunting a shark). No friction → flat.
- **Specificity** over vagueness — a world, a wound, a mission.
- **Active protagonist** — "must / fights to / races to". They *do*; things don't merely happen to them.
- **One story, not three** — pick the spine, cut the subplots.
- **Under ~35 words** — if it won't fit in one breath, it's smuggling in backstory.

Mistakes it now guards against: naming characters, describing **theme** instead of plot ("a story about
redemption"), withholding the hook to be coy, backstory-stuffing, and **passive framing** ("a man discovers his
life is a lie").

The test the prompt applies before answering: *could a stranger picture the poster, the genre, and the shape of
the ending?* If they'd ask "okay, but what happens?" — it's a situation, not a story.

## 4. The system — the two lints

Both live in `verticalLints()` and fire only when a seed **has** a logline (empty = *early, not wrong* — the
house rule across this engine). Both are `warn`, both anchor to the seed node so the fix lands where the author
can act.

| Rule | Fires when | Why deterministic is enough |
|---|---|---|
| `logline_overlong` | word count > `LOGLINE_MAX_WORDS` (35) | Length is the one purely mechanical signal in the anatomy; over the bar almost always means subplot/backstory crept in. |
| `logline_static` | no active-drive verb matches `LOGLINE_ACTIVE_VERB` | A passive-framed logline ("...discovers his life is a lie") usually signals a passive story. |

Deliberate scope line: the lints check only the **mechanically checkable** subset (length, active verb). The
*judgment* axes — irony, specificity, one-story — are craft calls a regex can't make without false positives, so
they live in the **prompt** (generator's job) and could later become an LLM **read** (like `craft_flag` /
`observed_shape_fit`: an LLM sensor writes a verdict onto the node, a pure function judges it against a floor,
gated by a freshness hash). That's the natural next tier if these two prove too coarse — I did **not** build it
now (no new edge fn / DB column / paid call for a seed that's one sentence).

The `LOGLINE_ACTIVE_VERB` set intentionally **excludes** the passive-signal verbs the anatomy names — *discover,
find, learn, realize, deal with* — because "a man discovers his life is a lie" is the anti-pattern we want to
*catch*, not accept.

## 5. Parity note (why the same code is in two files)

`novelDna.ts` (browser engine) and `_shared/novel-dna.ts` (edge twin) are **parity-locked**: a test runs both
over identical fixtures and deep-equals the output (`novelDna.parity.test.ts`). Any lint added to one MUST be
byte-identical in the other, or the lock fails. Both twins got the same block; 485 parity + engine tests pass,
plus a new focused test (`logline lints:`) pinning fire/silent behaviour.

## 6. Picture

```
 raw idea (brief)                          seed.logline
      │                                         │
      ▼   dna-expand target="logline"           ▼   verticalLints() in validate()
  ┌─────────────────┐  writes   ┌──────────┐  reads  ┌──────────────────────────┐
  │ ANATOMY prompt  │──────────▶│  seed    │────────▶│ logline_overlong (>35w)  │
  │ 5 parts, irony, │           │ .logline │         │ logline_static (passive) │
  │ active, <35w,   │           └──────────┘         └──────────────────────────┘
  │ poster test     │                                      │ warns anchor to seed
  └─────────────────┘                                      ▼
        generate  ───────────────────────────────────▶  verify
```

## 7. Reference

- Source craft note: the "logline anatomy" brief that seeded this task (core formula, Jaws example, the under-35
  poster/genre/ending test).
- In-repo neighbours doing the same *generate→verify* dance: the beat-sheet lint-then-repair
  (`dna-expand/index.ts`), and `craft_flag` / `movement_unfit` (LLM-sensor + pure-fn-judge) in `verticalLints`.
- Related memory: `project_brief_premise_logline` (raw premise ≠ derived logline), `project_dna_verify_layer`.

## Terms used (vocabulary)

- **Logline** — one/two-sentence pitch of the story's engine; the top DNA rung.
- **Generate→verify loop** — one path writes the artifact, an independent path grades it.
- **LLM-sensor + pure-fn-judge** — the model emits a *verdict*, but the *threshold/decision* lives in
  deterministic code (so the bar is auditable and version-controlled, not buried in a prompt).
- **Parity-locked twin** — two copies of one engine (browser + edge) held byte-identical by a deep-equality test.
- **Early, not wrong** — a lint stays silent on an unauthored field rather than nagging; absence ≠ defect.
