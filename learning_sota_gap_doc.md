# Learning: SOTA Gap Analysis & Collaboration Pattern

New concepts this round (earlier ones in `learning_state_axis.md`).

- **Modal output**
  - Literal: mode = the most probable value of a distribution
  - What it is: a single LLM sample gives the most statistically typical answer for the prompt — competent, predictable, never surprising
  - Here: why one scaffold pass reads as AI; the fix is critique loops / best-of-n, not better prompts

- **Best-of-n sampling**
  - Literal: generate n candidates, keep the best
  - What it is: sample several outputs, have a judge pick; quality scales with n at linear cost
  - Here: proposed at the beat level (Tier 2.4) because beats are one paragraph — cents per page

- **Self-Refine (Madaan et al., 2023)**
  - What it is: research showing LLMs improve substantially when they critique their own output against criteria and revise
  - Here: the grounding for the closed write→eval→revise loop (Tier 2.3) and the plan-critique loop (Tier 1.4)

- **Error compounding (in hierarchical generation)**
  - What it is: a flaw at a high rung (plan) is inherited by everything rendered below it; a dollar of quality pressure at the top is worth ~10 at the bottom
  - Here: why the plan-critique loop is priority #1 and why Tier 2 polish before Tier 1 is "lipstick on an episodic plot"

- **Few-shot voice anchoring**
  - Literal: few-shot = teaching by examples in the prompt
  - What it is: style instructions don't produce a voice; an exemplar passage in the prompt does
  - Here: the proposed voice-sample artifact — 300–500 words, author-picked, carried in the cached stable prefix of every render

- **Review gate**
  - What it is: a defined checkpoint where a human approves an artifact before automation proceeds
  - Here: five gates (brief, spine, plan, voice, editor's read); everything between them is automated

- **Editor-in-chief vs line editor (review economy)**
  - What it is: spend scarce human attention on small, high-leverage, low-resolution artifacts; never on per-unit approval of bulk output (fatigue → rubber-stamping)
  - Here: the design rule that kills "50 per-page approval dialogs"; author reviews the plan once, not every page

- **Showrunner model**
  - Literal: TV role that owns vision and approves, while a writers' room drafts
  - What it is: a collaboration split — human owns premise/taste/final read; AI drafts and self-revises; the rubric acts as automated story editor
  - Here: the target human/AI pattern in `docs/sota-story-generation.md` §4

- **Longinian test (the sublime)**
  - Literal: from Longinus, "On the Sublime" (1st c. rhetorical treatise)
  - What it is: does the work transport the reader — will a scene stay with them a month later?
  - Here: already in the eval rubric (§8); flagged as the one judgment the human owns at gate 5 because the judge can only approximate it

- **Genre contract / obligatory scenes (Story Grid)**
  - What it is: a genre is a promise of specific scenes (mystery → killer revealed); skipping them breaks the contract
  - Here: in the rubric (§6, §2); proposed as a plan-level checklist input for the critique loop
