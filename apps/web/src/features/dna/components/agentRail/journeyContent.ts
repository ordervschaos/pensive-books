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

// Short noun for the "Next step" button — "Start interview" / "Continue beat sheet" — keyed the same as
// NEXT_STEP_MESSAGE above. Kept separate from STEP_TEACH's prose because the button needs a 1-2 word
// object, not a sentence.
export const STEP_NOUN: Record<string, string> = {
  interview: "interview",
  seed: "logline",
  premise: "premise",
  pillar: "pillar",
  contract: "contract",
  cast: "cast",
  acts: "acts",
  beats: "beat sheet",
  scenes: "scenes",
  promises: "promises",
  prose: "scene",
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
  contract: "Next: the contract — your genre's promises AND your vision's, compiled: the obligatory scenes readers expect plus the moments you promised in the interview, pacing curves shaped to your stated intents, and voice bounds. It's how the book keeps the promises the brief and your vision made.",
  cast: "Next: the cast — the people the question gets tested on. Each carries a want (what they chase), a need (what they actually require), a wound (why), and a lie the wound taught them. Conflict is these colliding.",
  acts: "Next: the acts — the story's largest movements, each with a goal and a turning point that makes going back impossible. They're the load-bearing walls; beats and scenes hang off them.",
  beats: "Next: the beats — the causal chain of events, each linked by “therefore” or “but”, never “and then”. This is where the story stops being a list and becomes a machine where each event forces the next.",
  scenes: "Next: scenes — the smallest unit that turns. Someone enters wanting something and leaves with the value changed: win, lose, or twist. Flat scenes are where readers put books down.",
  prose: "Now the words. Each scene renders into prose one at a time, in the book's voice, honoring everything upstream — the beat's plan, the threads it must pay, the previous page. You review each page as it lands.",
  promises: "Last rung: the promise ledger — every open loop the book set up (foreshadowing, contests, obligatory scenes) that hasn't paid off. A story feels finished when every promise is paid on the page or deliberately waived.",
};

// ── Start doors — the interview's entry points ────────────────────────────────
// The interview is a SLOT-FILLING dialogue over brief.vision's sections (characters · world_setting ·
// plot_points · themes_aims · …), and a slot-filler doesn't care which slot lands first. So entry order was
// always free — but the rail offered exactly one button ("Start interview"), so authors never learned the
// door was wide, and defaulted to answering whatever the agent happened to ask first.
//
// These are the DOORS: one canned first message each, named by the MATERIAL the author actually has (a
// character, a scene) rather than by our internal stage. A door changes only what the agent asks first and
// which vision section it captures first. The ladder underneath (idea → foundations → structure → scenes →
// prose) is a dependency DAG and is NOT touched — derivation order is fixed, entry order is free. Shown only
// on a fresh thread at the interview step; the interview then converges exactly as STEP_RECIPE.interview says.
export interface StartDoor { key: string; label: string; hint: string; message: string; opensPicker?: boolean }

export const START_DOORS_LEAD = "Where do you want to start? Any of these works — I'll take it from there.";

export const START_DOORS: StartDoor[] = [
  {
    key: "character", label: "A character", hint: "someone I can't stop thinking about",
    message: "I want to start from a character. Ask me about them first — who they are, what they want, and what's wrong with them — and capture what I say to the vision's characters section. Once they're on the page, work outward from them to the world and what goes wrong.",
  },
  {
    key: "hook", label: "A hook", hint: "the what-if that started it",
    message: "I want to start from the hook — the what-if that made me want to write this. Ask me for it, push on what makes it more than a one-liner, and capture it to the vision's plot points. Then help me find who it happens to.",
  },
  {
    key: "scene", label: "A scene", hint: "a moment I can already see",
    message: "I want to start from a scene I can already picture. Let me describe it, ask what makes it matter, and capture it to the vision's plot points. Then work backwards with me: who's in it, what had to happen for it to be possible, and where the book goes after it.",
  },
  {
    key: "world", label: "A world", hint: "a place with rules",
    message: "I want to start from the world — the place and its rules. Ask me what's true there and what it costs the people living in it, capture it to the vision's world / setting, then help me find the character those rules press hardest on.",
  },
  {
    key: "feeling", label: "A feeling", hint: "what the reader leaves with",
    message: "I want to start from the feeling I want the reader to leave with. Ask me what it is and what would earn it, capture it to the vision's themes / aims, then help me find the story that lands it.",
  },
  {
    key: "structure", label: "A structure", hint: "a plot skeleton to fill in", opensPicker: true,
    message: "", // supplied by STRUCTURE_DOOR_MESSAGE once the method is picked
  },
  {
    key: "nothing", label: "Nothing yet", hint: "pitch me a few directions",
    message: "I don't have a starting point yet. Ask me one or two quick questions if that helps, then pitch 3–4 distinct directions this book could take — each as one vivid sentence. We'll pick one and interview from there.",
  },
];

// ── The structure door ────────────────────────────────────────────────────────
// The one door that DOES something before it speaks. The others only seed the conversation; this one writes
// the book's plot-skeleton method to the pillar and materializes its slots as real empty rows (dnaSkeleton's
// chooseStructure), THEN starts the interview — so the interview has a frame to walk instead of a blank page,
// and every slot already has an id the author can type into in any order.
//
// Author-facing blurbs for the registry's methods (novelDna STRUCTURE_TEMPLATES). Kept here, not on the
// template, because they are marketing copy for a choice — the template's own `craft` strings are guidance
// the GENERATOR reads, and the two should be free to diverge in voice. A method with no blurb still shows
// (its label carries it), so adding a registry entry can't break this list.
export const STRUCTURE_BLURB: Record<string, string> = {
  weiland_3act: "The house default. Nine load-bearing turns across three acts — the fewest moving parts that still hold a novel up.",
  save_the_cat: "Fifteen beats, tightly positioned. The most prescriptive option: best when you want the shape decided so you can spend everything on the scenes.",
  heros_journey: "Twelve stages of departure, initiation, and return. Suits a story about someone who comes back changed.",
  none: "No skeleton. You get the premise and pillar to write into, and nothing else is assumed.",
};

export const STRUCTURE_DOOR_LEAD = "Pick the skeleton you want to fill in. Every slot becomes a real, empty row you can write into in any order — and the interview will walk you through them.";

/** What the author says to the agent once the skeleton is on the page. `label` is the template's own label
 *  (or "no structure"), so the agent names the method the author actually chose. */
export const STRUCTURE_DOOR_MESSAGE = (label: string, blank: boolean): string =>
  blank
    ? "I want to work without a plot skeleton — no template. Interview me from scratch: my characters, the world, what goes wrong, and what it's all for. Don't assume a three-act shape."
    : `I've chosen the ${label} structure and its slots are now on the tree as empty placeholder beats. Use it as the frame for the interview: walk me through the slots in order, a couple at a time, and ask what I want to happen at each one. Where I already know, capture it; where I don't, offer options rather than leaving it blank. Save what I tell you to the vision as we go, and don't rewrite the skeleton — we're filling it in.`;

// The seed step, but with NO idea in the brief yet — the rung before the first rung. The greeting and the
// nudge both switch to ideation: the agent's job is to find the spark with the author, not demand one.
export const IDEA_TEACH = "Everything downstream is derived from the idea, so we start by finding one worth deriving from — a character in trouble, a place with rules, a feeling you want the reader to leave with. Any spark works.";
export const IDEA_MESSAGE = "I don't have a story idea yet. Ask me one or two quick questions if that helps, then pitch 3–4 distinct story ideas that fit my brief — each as one vivid sentence. We'll pick one and shape it into a logline.";
