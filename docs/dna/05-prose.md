# DNA: Prose (stage 5 — render + read-repair) + the exit seam

> Prose breaks the pattern: every rung before it generates structured JSON on the
> edge worker; prose generates long text, which the ~150s worker can't hold. Five
> things happen here, then the tree projects onto pages.

## 1. The worker ceiling (why prose is special)

Supabase free-plan worker dies ~150s. Prose is the longest call (max_tokens
8000). ~54% of prose calls were being killed -> 499. So prose cannot run
synchronously on the worker.

## 2. Two-hop render (prepare -> stream off-worker)

```
Hop1 browser -> dna-expand(prepare:true)  FAST, under ceiling: assembles the whole
                prompt, returns {prepared}, NO model call (dna-expand:639)
Hop2 browser -> /api/stream-prose         OFF-worker (Vite mw dev / Vercel fn prod),
                streams the long generation (streamProse dnaExpand.ts:94)
```
Assembly and generation split onto two runtimes.

## 3. Context assembly — the rolling digest (`dna-expand:270`)

Not "all pages verbatim" but a digest:
- **story_so_far** — rolling PREFIX FOLD (`:230`). Each page's delta cached on
  authoring.prose_digest, chained by src_hash (prose) + prev_hash (accumulator).
  Cache hit = no model call. Steady state = exactly ONE fold runs. Edit earlier
  page -> chain breaks from there, suffix recomputes. O(1)/page vs O(N^2).
  Each fold persisted immediately (`:258`); over budget -> partial digest (`:251`).
- **continuity_ledger** — grounded id-keyed facts (scene ledger + entity registry).
- **reader_impressions** — what landed, weighted 1-5 (affective memory model).
- **avoid_repeating / _dialogue** — blocklist of distinctive phrases + exact lines
  from ALL prior pages (repetition = #1 failure mode).
- **previous_page** — full text, but "voice + cadence ONLY — open in a DIFFERENT
  place/time/register" (verbatim prev page was the top echo source).
- location palette (SETTING) so a place reads consistently.

## 4. Agent-curated render brief

Digest is COMPUTED; some continuity is RETRIEVED. Before each render the agent
(STEP_RECIPE.prose, `dnaJourney.ts:152`) reads the beat + prev page,
search_nodes for threads/objects/facts to honor, and attaches a curated brief
{focus, mustHonor, avoid} via propose_prose_render — injected verbatim,
AUGMENTING the digest. Author applies; prose streams in the browser. The agent
never writes prose itself.

## 5. Read-repair loop (generate<->verify duality)

AFTER prose: check_against_contract judges vs the brief; factLedger produces
observed_establishes / continuity_flags (OBSERVED state) compared to the beat's
PLANNED establishes = a trace-diff. If the PREVIOUS page drifted (dropped
thread, contradiction), propose_node_ops to fix the tail FIRST, then continue.
Investigate -> fix tail -> render next. Can cascade UP the ladder to repair a beat.

## Write-back

expandNode (dnaExpand.ts:222) merges prose into scene.content, stampProse sets
prose_src_hash (which plan it was written from), status accepted. Its delta
folds into the digest for the next page.

## Exit seam: tree -> pages (`novelDnaRender.ts:28`)

Prose lives in the tree (scene.content.prose); reader reads `pages`.
reconcileDna projects: chapter -> section page (title) + text page (scenes'
prose concatenated).
- incremental: only changed rows write (sig diff `:93`)
- non-destructive: archive, never hard-delete (`:50`)
- idempotent: keyed on metadata.node_id; renumber via negative temp index range
  (`:80`) so live pages never collide on (book_id, page_index) unique index.

render + publish are DELIBERATE AUTHOR GESTURES (dnaJourney.ts:181): applying ops
writes book_nodes only; crossing to pages (render) and going public (publish) are
the author's. The agent surfaces the buttons, doesn't press them.

## Picture

```
SCENE plan -> agent brief {focus,mustHonor,avoid}
   -> Hop1 prepare (digest+ledger+impressions+blocklist+prevpage+palette+brief)
   -> Hop2 /api/stream-prose (off-worker) -> prose -> scene.content.prose (prose_src_hash)
        -> delta folds into digest for next page
   -> check_against_contract (observed vs planned trace-diff) -> fix tail if drifted
   -> reconcileDna (author) -> pages -> reader ; publish (author) -> public
```

## Terms

worker ceiling / off-worker streaming (two-hop prepare->stream) · rolling/
incremental digest (prefix fold, src_hash/prev_hash chain, delta storage,
O(1)/page) · content-addressed caching · retrieval-augmented context (brief
augments digest) · blocklist/anti-repetition · affective memory model (reader
impressions) · generate<->verify duality / read-repair loop / trace-diff ·
provenance stamp (prose_src_hash) · projection/reconcile (idempotent,
incremental, non-destructive) · render seam & deliberate author gesture ·
graceful degradation (fold budget -> partial digest).
