// agentCommands — the slash-command registry for the DNA omni-rail agent (docs/agent-rail.md).
//
// A command is sugar over a plain message: picking one drops an editable, context-carrying instruction
// into the composer (the author appends steering, then sends). The visible, steerable successor to
// per-stage "generate" buttons — every AI action passes through the one rail. The agent always sees the
// whole book; there is no context fence (docs/agent-context-model.md). `aspect` only gates command
// RELEVANCE (offer "generate beats" when beats are absent, "revise" when present) — not what's touched.
import type { Aspect } from "@/features/dna/lib/agentThread";

export interface AgentCommand {
  id: string;
  /** Typed after "/" to filter — e.g. "generate beats". */
  trigger: string;
  label: string;
  hint: string;
  /** generate = offered when its aspect has NO nodes yet; revise = when it does; discuss = always. */
  kind: "generate" | "revise" | "discuss";
  /** The aspect this command gates on for RELEVANCE (generate vs revise). Omit for discuss commands. */
  aspect?: Aspect;
  /** The instruction dropped into the composer (editable). A trailing space invites steering. */
  prompt: string;
}

// The agent proposes node ops over the DNA tree, so "generate" = propose the missing nodes for an
// aspect; "revise" = change the existing ones. The author reviews every proposal before it applies.
export const AGENT_COMMANDS: AgentCommand[] = [
  {
    id: "generate-beats", trigger: "generate beats", label: "Generate beats",
    hint: "Propose beats for acts that have none",
    kind: "generate", aspect: "story",
    prompt: "For each act that has no beats yet, propose the beats that realize it — each connecting to the last with therefore/but, turning a value. Propose them for review.",
  },
  {
    id: "revise-structure", trigger: "revise structure", label: "Revise structure",
    hint: "Change the acts & beats — add your direction",
    kind: "revise", aspect: "story",
    prompt: "Revise the structure: ",
  },
  {
    id: "generate-scenes", trigger: "generate scenes", label: "Generate scenes",
    hint: "Propose scenes for beats that have none",
    kind: "discuss",
    prompt: "For each beat that has no scenes yet, propose the scene(s) that dramatize it — each with a pov, goal, conflict, outcome, and a real value shift. Propose them for review.",
  },
  {
    id: "revise-scenes", trigger: "revise scenes", label: "Revise scenes",
    hint: "Change the scenes — add your direction",
    kind: "revise", aspect: "story",
    prompt: "Revise the scenes: ",
  },
  {
    id: "revise-cast-world", trigger: "revise cast & world", label: "Revise cast & world",
    hint: "Deepen the cast, world, tentpoles, voice",
    kind: "revise", aspect: "cast_world",
    prompt: "Revise the cast & world: ",
  },
  {
    id: "revise-premise", trigger: "revise premise", label: "Revise the premise",
    hint: "The logline, dramatic question, shape",
    kind: "revise", aspect: "premise",
    prompt: "Revise the premise: ",
  },
  {
    id: "summarize", trigger: "summarize", label: "Summarize",
    hint: "The story as it stands, in a few lines",
    kind: "discuss",
    prompt: "Summarize where the story stands in a few lines.",
  },
  {
    id: "pressure-test", trigger: "pressure-test", label: "Pressure-test",
    hint: "The weakest link and the highest-leverage fix",
    kind: "discuss",
    prompt: "Pressure-test the story: where is it strongest, where does it sag, and what's the single highest-leverage fix?",
  },
];

/** Commands offered given which aspects exist: generate→aspect absent, revise→aspect present. */
export function availableCommands(created: Aspect[]): AgentCommand[] {
  return AGENT_COMMANDS.filter((c) => {
    if (c.kind === "discuss" || !c.aspect) return true;
    const has = created.includes(c.aspect);
    return c.kind === "generate" ? !has : has;
  });
}

/** Filter by the text typed after "/". */
export function matchCommands(cmds: AgentCommand[], query: string): AgentCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return cmds;
  return cmds.filter((c) => c.trigger.includes(q) || c.label.toLowerCase().includes(q));
}
