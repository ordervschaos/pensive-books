// llmAuthor — the scripted author, backed by a model instead of regexes.
//
// WHY THIS REPLACES THE REGEX AUTHOR (scripts/harness/author.ts):
// A regex author is coupled to how the agent PHRASES its questions. Different agent versions phrase
// differently, so variant B could out-score variant A purely by hitting the patterns more often — the
// fixture stops being variant-neutral, which is exactly what an A/B fixture must be. Building the regex
// version surfaced this the hard way: /resolve/ matched inside "unresolved", topic rules matched the
// agent's own recap, "Who's inside?" missed a `who is (the|our|she)` rule, and so on. Every one of those
// was a fixture failure that looked like an agent failure.
//
// The model author is phrasing-independent: it reads the collaborator's message the way a person would.
// It is constrained to a FACT SHEET and instructed never to invent — so it can still only tell the agent
// what the fixture says, which is the property that made the regex version worth having.
//
// Determinism is preserved as far as it can be: temperature 0, a fixed cheap model, and a fact sheet that
// is identical across arms. The residual variance is far smaller than the phrasing-coupling bias it
// removes — and unlike that bias, it averages out over trials.
import { questionsIn, type AuthorLog, type ScriptedAuthor } from "./author.ts";

/** AuthorLog plus whether the model actually emitted its classification marker. */
type LlmLog = AuthorLog & { markerSeen?: boolean };
import { harnessLlm, harnessLlmAvailable } from "./llm.ts";

const SYSTEM = `You are the AUTHOR of a book, talking to a writing collaborator who is interviewing you to shape a premise.

THE ONLY THINGS YOU KNOW ARE THE FACTS GIVEN BELOW. You have not decided anything else.

RULES
- Reply in first person, 1-3 sentences, plain and direct. No preamble, no pleasantries, no markdown.
- Use ONLY the facts. If they ask something the facts do not cover, say you haven't decided that yet and invite a more specific question. NEVER invent a detail — not a name, not a date, not a place.
- If they are not asking anything (just narrating, summarising, or proposing), reply briefly that it sounds right and tell them to go ahead.
- Do NOT write the logline or the premise yourself. That is their job, not yours.
- Do not repeat a fact they have already been told unless they ask again.

END your reply with a marker on its own line, exactly one of:
[covered]   — the facts answered what they asked
[uncovered] — the facts did not cover it, so you told them you haven't decided`;

export interface LlmAuthorOpts {
  facts: string[];
  brief?: unknown;
  pushAfter?: number;
  push?: string;
  model?: string;
}

/**
 * Derive the fact sheet from the fixture's existing keyed answers, so there is ONE source of truth for
 * what the author knows and the two author implementations can never disagree about it.
 */
export function factsFrom(script: ScriptedAuthor): string[] {
  return (script.keyed ?? []).map((r) => r.answer);
}

export class LlmAuthor {
  readonly log: LlmLog[] = [];
  constructor(private readonly opts: LlmAuthorOpts) {
    if (!harnessLlmAvailable()) {
      throw new Error("LLM author needs DEEPSEEK_API_KEY in supabase/functions/.env (or pass --author regex)");
    }
  }

  private get answered(): number { return this.log.filter((l) => l.matched !== "(push)").length; }

  async answer(rawMessage: string): Promise<string> {
    // Patience runs out — same contract as the regex author. Without this the run can only ever test
    // "does the agent converge unprompted?", never "can it close with a cooperative author?".
    const limit = this.opts.pushAfter;
    if (limit !== undefined && this.answered >= limit) {
      const push = this.opts.push ?? "That's enough questions — you have what you need. Write the logline and the premise now.";
      this.log.push({ question: "(push)", answer: push, matched: "(push)" });
      return push;
    }

    const asked = questionsIn(rawMessage);
    const factSheet = this.opts.facts.map((f) => `- ${f}`).join("\n");
    const user = `FACTS YOU KNOW:\n${factSheet}\n\n---\nThe collaborator just said:\n\n${rawMessage}\n\nReply as the author.`;

    // Via the shared client (harness/llm.ts): temperature 0, one pinned model, its own key, and 3 retries.
    // The retries matter — without them a single transient 5xx from the host aborts an entire run, which
    // then reads as an agent failure. Nothing here logs to `ai_calls`; the simulated author must not appear
    // in the trajectory metrics it exists to help measure.
    const text = await harnessLlm({ system: SYSTEM, user, maxTokens: 400, model: this.opts.model });

    // Classify from an EXPLICIT marker the model emits, not by regexing its prose. Inferring it was a real
    // bug: a reply that answered the question and then hedged on a sub-part ("...not decided yet whether
    // she's running from something") was scored as an uncovered question, inflating `fallbackUses` — the
    // same match-a-regex-against-free-text mistake this class of author exists to avoid. When the marker
    // is missing, treat it as covered rather than guessing: a false "uncovered" reads as a fixture gap and
    // would send the next person to edit a fixture that is fine.
    const marker = text.match(/\[(covered|uncovered)\]\s*$/i);
    const answer = text.replace(/\s*\[(covered|uncovered)\]\s*$/i, "").trim();
    const matched = !asked.trim()
      ? "(nudge)"
      : marker?.[1].toLowerCase() === "uncovered"
        ? "(undecided)"
        : "(llm)";
    this.log.push({ question: asked || "(no question asked)", answer, matched, markerSeen: !!marker });
    return answer;
  }

  get questionCount(): number { return this.log.length; }
  /** The facts did not cover what was asked — same meaning as the regex author's fallback. */
  get fallbackUses(): number { return this.log.filter((l) => l.matched === "(undecided)").length; }
  get nudges(): number { return this.log.filter((l) => l.matched === "(nudge)").length; }
  get pushes(): number { return this.log.filter((l) => l.matched === "(push)").length; }
  /** Not meaningful for a model author — it has no rules to overlap or re-fire. */
  get repeats(): number { return 0; }
  get ambiguous(): number { return 0; }
  /** Replies where the model omitted its [covered]/[uncovered] marker — those default to covered, so a
   *  high count means `fallbackUses` is under-reporting and the prompt needs tightening. */
  get markerMisses(): number { return this.log.filter((l) => !l.markerSeen && l.matched !== "(push)" && l.matched !== "(nudge)").length; }
}
