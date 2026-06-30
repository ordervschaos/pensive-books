# TODO — Live-verify the true-agent verify loop (Steps 2 & 3)

Status: **not started**
Owner: —
Context: `docs/true-agent.md` (Steps 1–3 shipped as engine + edge fn + bridge + dev dashboards; **never run end-to-end**). This todo closes the "assembled but never switched on" gap before building anything further.

## Goal
Run the meter read (Step 2) and the continuity ledger (Step 3) against a real book through the **dev bridge**, and confirm the full path works: trigger → read → on-node write → live render → editor handoff.

## Pre-reqs
- Pick a test book that has **prose on scenes** AND at least one **`meter` node** with planned `readings` (Step 2 needs both; Step 3 needs scene prose). Note its `bookId`.
- Dev server + `eval-bridge.mjs` running; `VITE_EVAL_BRIDGE_URL` set so AI routes through `localhost:8787` (always-use-the-bridge rule).

## Step 2 — meter read (`/dna/meters`)
- [ ] Open `/books/<slug>/dna/meters`. Confirm the solid (plan) and dashed (target) lines render.
- [ ] Click **"Read the emotional trace."** Bridge logs `Reading meters · book <id>…`.
- [ ] Confirm a **dotted (observed) line** appears via Realtime (no refresh).
- [ ] Confirm `read_gap` lints show on meters where prose departs from plan; legend reads `solid = plan · dashed = target · dotted = read`.
- [ ] Spot-check `book_nodes`: the rated beats gained `content.observed_readings`; authored `readings` untouched.
- [ ] **Staleness regression:** confirm the scenes under a rated beat did **not** flip to stale (the `inputHash` `OUTPUT_FIELDS` fix). ← key check.
- [ ] Click **"Send gaps to editor."** Lands on `/dna/tree` with a `revise-agent` run carrying the gap findings.

## Step 3 — continuity ledger (`/dna/ledger`)
- [ ] Open `/books/<slug>/dna/ledger`.
- [ ] Click **"Build continuity ledger."** Progress note ticks `Reading scene n/total…`; bridge logs `Reading facts · scene …`.
- [ ] Confirm the canon table fills (key → value → scene #), in reading order.
- [ ] Verify the prefix-sum: a fact set in scene 3 appears for scenes 4+, and a re-asserted key shows the **superseding** (later) value.
- [ ] If any contradiction is found, confirm it renders in the red breaks panel + as a `continuity_break` lint.
- [ ] Spot-check `book_nodes`: scanned scenes gained `content.observed_establishes`; **prose did not go stale** (output fields excluded from the prose hash). ← key check.
- [ ] Click **"Send breaks to editor"** (only enabled when breaks exist) → `revise-agent` run on `/dna/tree`.

## Success criteria
- Both reads complete with no console/bridge errors.
- Observed data lands on-node and renders live (refresh = no-op).
- **No spurious staleness** introduced by either write (the regression checks above).
- Findings reach `revise-agent` and the agent thread opens.

## If it fails
- Capture the failing call from `bridge-calls.log` (full prompt) + the bridge error.
- Note which leg broke (read / write / render / handoff) and file against `docs/true-agent.md`.

## Next after this passes
Per `docs/true-agent.md`: wire per-page verify **into** prose-gen (Step 3 fast-follow + the per-page idea), then loop-closure (verify → revise → re-read → taste gate). World/cast/relationship graph = separate second pillar.
