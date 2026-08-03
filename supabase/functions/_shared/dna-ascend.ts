// dna-ascend — INDUCTION over the DNA tree: given what the author has written ANYWHERE, infer the rungs
// above it. The generalization of dna-decompose (P3, doc_1785673597000.md §4c).
//
// The engine has always had one direction. `dna-expand` DEDUCES: a parent constrains its children, top-down
// from the brief. `dna-decompose` was the only inductive pass, and it was hard-wired to one input — imported
// prose — so it could only ever run the chapters→beats→acts→premise path.
//
// But induction is what the six doors need. A writer arrives holding ONE thing (a character, a world, a
// "what if", a voice, a theme, a plot) and the story is the machine that forces the other five into being.
// Character-first means: you wrote a wound, and the controlling idea, the premise and the logline are now
// IMPLIED and owed. This module answers "which rungs are owed, and on what evidence".
//
// The key realization is that the fill fold already encodes the doors. A `stub` — empty itself, but with
// written material somewhere beneath — is EXACTLY "a parent is owed here". Write a character (which hangs
// off the pillar) and the pillar, premise and seed all become stubs in one stroke; that IS the character
// door, with no door-detection code and nothing to ask the author. Whichever rung they filled first, the
// frontier between written and empty is the work list.
//
// Deliberately NOT here: the model call. This module is pure — it decides what to ask and how to apply the
// answer, so both halves are testable without a network. The caller does the inference.
import { fillMap, LADDER_KINDS, type DnaNode, type NodeKind } from "./novel-dna.ts";

/** Ladder rungs, coarsest first — the order induction has to run in, since a premise inferred without its
 *  pillar would be guessing at the thing the pillar is about to state. */
const RUNG_ORDER: NodeKind[] = [...LADDER_KINDS];

/** A rung that is OWED: empty itself, with written material beneath it. The author started lower down. */
export function owedRungs(nodes: DnaNode[]): DnaNode[] {
  const fills = fillMap(nodes);
  return nodes
    .filter((n) => (RUNG_ORDER as string[]).includes(n.kind) && fills.get(n.id)?.state === "stub")
    .sort((a, b) => RUNG_ORDER.indexOf(a.kind) - RUNG_ORDER.indexOf(b.kind));
}

/** True when there is anything to induce at all. */
export const hasAscent = (nodes: DnaNode[]): boolean => owedRungs(nodes).length > 0;

// What each kind contributes as EVIDENCE for the rung above it. Deliberately narrow: induction reasons over
// the load-bearing fields, not whole content blobs, so a long prose scene can't crowd out the cast.
const EVIDENCE_FIELDS: Partial<Record<NodeKind, string[]>> = {
  character: ["name", "role", "want", "need", "wound", "lie", "truth"],
  relationship: ["a", "b", "bond", "charge"],
  world_fact: ["name", "rule", "mechanism"],
  location: ["name", "summary", "mood"],
  thread: ["name", "kind", "promise", "payoff"],
  game: ["name", "win_condition", "lose_condition", "stake"],
  tentpole: ["name", "summary"],
  voice_profile: ["pov", "tense", "style"],
  seed: ["logline"],
  premise: ["dramatic_question", "shape"],
  pillar: ["controlling_idea", "ending"],
  act: ["title", "goal", "turning_point"],
  beat: ["summary", "connector", "polarity"],
  scene: ["goal", "conflict", "outcome"],
};

const pick = (content: Record<string, unknown>, fields: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = content[f];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    out[f] = v;
  }
  return out;
};

/** Every written node beneath `rootId` (exclusive), as compact evidence lines grouped by kind. Prose is
 *  never inlined — a scene contributes its PLAN, because induction is reasoning about story shape, and the
 *  prose of one scene would drown the signal from thirty plan rows. */
export function ascentEvidence(nodes: DnaNode[], rootId: string, maxPerKind = 12): string {
  const kids = new Map<string, DnaNode[]>();
  for (const n of nodes) if (n.parent_id) (kids.get(n.parent_id) ?? kids.set(n.parent_id, []).get(n.parent_id)!).push(n);
  const seen = new Set<string>();
  const byKind = new Map<string, string[]>();
  const walk = (id: string) => {
    for (const c of kids.get(id) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const fields = EVIDENCE_FIELDS[c.kind as NodeKind];
      const body = fields ? pick(c.content as Record<string, unknown>, fields) : {};
      if (Object.keys(body).length) {
        const list = byKind.get(c.kind) ?? byKind.set(c.kind, []).get(c.kind)!;
        if (list.length < maxPerKind) list.push(`- ${JSON.stringify(body)}`);
      }
      walk(c.id);
    }
  };
  walk(rootId);
  if (!byKind.size) return "";
  return [...byKind].map(([kind, lines]) => `${kind.toUpperCase()}:\n${lines.join("\n")}`).join("\n\n");
}

export interface AscentAsk {
  /** The owed rungs, coarsest first — what the model must write. */
  targets: { id: string; kind: NodeKind }[];
  /** What the author has already written, as the ground truth induction must honor. */
  evidence: string;
}

// What v1 can actually WRITE BACK. `owedRungs` reports the whole truth — writing a beat genuinely owes its
// act as well as the three rungs above — but the apply path is dna-decompose's `topOps`, which resolves a
// rung by KIND and so only works for the singletons. Acts and beats are positional and plural: inducing
// them means minting/segmenting against a spine (what `actOps` does for imported chapters), which is a
// different write and deserves its own pass rather than being smuggled in here half-formed.
const ASCENDABLE: NodeKind[] = ["seed", "premise", "pillar"];

/** The whole ask, or null when nothing is owed (a book built top-down never needs this). Evidence is
 *  gathered from the HIGHEST owed rung, so one pass sees everything the author has written. */
export function buildAscentAsk(nodes: DnaNode[]): AscentAsk | null {
  const owed = owedRungs(nodes).filter((n) => ASCENDABLE.includes(n.kind));
  if (!owed.length) return null;
  const evidence = ascentEvidence(nodes, owed[0].id);
  if (!evidence) return null; // stub with nothing legible beneath it — nothing to reason from
  return { targets: owed.map((n) => ({ id: n.id, kind: n.kind })), evidence };
}

/** The instruction. Kept here beside the ask so the contract the prompt states and the ops the applier
 *  accepts can't drift into disagreeing about what a valid answer looks like. */
export function ascentPrompt(ask: AscentAsk): string {
  const wanted = ask.targets.map((t) => t.kind);
  const shape: string[] = [];
  if (wanted.includes("seed")) shape.push(`"seed": { "logline": "one or two sentences — protagonist · inciting incident · goal · obstacle · stakes" }`);
  if (wanted.includes("premise")) shape.push(`"premise": { "dramatic_question": "the ONE question the whole book lives inside" }`);
  if (wanted.includes("pillar")) shape.push(`"pillar": { "controlling_idea": "what the book argues, as a sentence", "ending": "how it resolves" }`);
  return `The author has already written the material below. It is GROUND TRUTH: do not contradict it, do not restate it, do not invent a different story that would fit it better.

Your job is INDUCTION — infer the higher-level story this material is already implying, and state it. You are not proposing a new story; you are naming the one that is latent in what they wrote. Every claim you make must be traceable to the evidence: if the cast has a wound and a lie, the controlling idea is what that wound ARGUES; if there are beats, the dramatic question is what they are collectively asking.

Where the evidence genuinely underdetermines a rung, choose the reading that keeps the most of it intact rather than the most dramatic one.

WHAT THE AUTHOR HAS WRITTEN:
${ask.evidence}

Output ONLY this JSON (no prose, no fences), filling every key:
{ ${shape.join(", ")} }`;
}
