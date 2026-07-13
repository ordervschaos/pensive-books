// What the "next step" nudge SAYS when clicked, keyed by dnaJourney's STEP_RECIPE substep — so the chat
// bubble names the actual action instead of a one-size-fits-all "let's work on the next step" that read as
// disconnected from whatever the button was visibly offering (e.g. "generate the logline").
export const NEXT_STEP_MESSAGE: Record<string, string> = {
  interview: "Interview me about my book.",
  seed: "Generate logline options for the seed.",
  premise: "Generate premise options for the central question.",
  pillar: "Set the pillar's controlling idea and ending.",
  contract: "Compile the contract from the brief.",
  cast: "Add the core cast.",
  acts: "Generate the acts.",
  beats: "Generate the beat sheet.",
  scenes: "Break the next beat into scenes.",
  promises: "Settle the next open promise.",
  prose: "Write the next scene.",
};

// The guide's teaching line for each journey substep — what the concept IS and why the book needs it,
// in plain words. Shown in the rail's empty state (the greeting) so a first-time author learns the craft
// term for the rung they're on before the agent even speaks. Keyed by dnaJourney's STEP_RECIPE substep,
// like NEXT_STEP_MESSAGE above. The agent itself carries the same duty in its system prompt ("Teach as
// you go" in book-agent) — this is the zero-cost, zero-latency copy of that stance.
export const STEP_TEACH: Record<string, string> = {
  interview: "Before we build anything, I'll interview you — your characters, world, plot points, aims — and save it all to the book's vision so every later step honors it.",
  seed: "First rung: the logline — your whole story in one sentence: who wants what, what stands in the way, and what's at stake. It's the cheapest place to fix a story; one sentence is easy to change, 80,000 words are not.",
  premise: "Next: the premise — your logline turned into a question with a price (“Can she win X without losing Y?”). Every act, beat, and scene below exists to make that question harder before it's answered.",
  pillar: "Next: the pillar — what your story argues is true (its controlling idea) plus the ending that proves it. Pin it now and everything generated below bends toward the same point instead of wandering.",
  contract: "Next: the contract — your genre's promises, compiled: the obligatory scenes readers expect, target tension curves, and voice bounds. It's how the book keeps the promises the brief made.",
  cast: "Next: the cast — the people the question gets tested on. Each carries a want (what they chase), a need (what they actually require), a wound (why), and a lie the wound taught them. Conflict is these colliding.",
  acts: "Next: the acts — the story's largest movements, each with a goal and a turning point that makes going back impossible. They're the load-bearing walls; beats and scenes hang off them.",
  beats: "Next: the beats — the causal chain of events, each linked by “therefore” or “but”, never “and then”. This is where the story stops being a list and becomes a machine where each event forces the next.",
  scenes: "Next: scenes — the smallest unit that turns. Someone enters wanting something and leaves with the value changed: win, lose, or twist. Flat scenes are where readers put books down.",
  prose: "Now the words. Each scene renders into prose one at a time, in the book's voice, honoring everything upstream — the beat's plan, the threads it must pay, the previous page. You review each page as it lands.",
  promises: "Last rung: the promise ledger — every open loop the book set up (foreshadowing, contests, obligatory scenes) that hasn't paid off. A story feels finished when every promise is paid on the page or deliberately waived.",
};

// The seed step, but with NO idea in the brief yet — the rung before the first rung. The greeting and the
// nudge both switch to ideation: the agent's job is to find the spark with the author, not demand one.
export const IDEA_TEACH = "Everything downstream is derived from the idea, so we start by finding one worth deriving from — a character in trouble, a place with rules, a feeling you want the reader to leave with. Any spark works.";
export const IDEA_MESSAGE = "I don't have a story idea yet. Ask me one or two quick questions if that helps, then pitch 3–4 distinct story ideas that fit my brief — each as one vivid sentence. We'll pick one and shape it into a logline.";
