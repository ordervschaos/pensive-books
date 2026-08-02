// The scripted author — a user simulator that answers the agent's `ask_author` questions from the
// fixture instead of the "I'm away" stub auto-accept mode uses.
//
// Why this exists at all: the premise rung OPENS with an interview. If the harness lets AUTO_ANSWER
// handle it, the agent invents an author's intent and then satisfies it — a strictly easier task than
// the one shipped to users, and one where every variant looks good. Scripting the answers is what makes
// the eval measure *interviewing* rather than *inventing*.
//
// Matching is deliberately dumb (first regex whose pattern hits the question text). The point is not
// clever routing — it's that `fallbackUses > 0` is a LOUD signal the fixture is under-specified for this
// agent version, which is itself a finding worth reporting.

export interface ScriptedAuthor {
  /** Answer used when nothing matches. Keeps a run from deadlocking, but its use is recorded. */
  default: string;
  /** Reply when the agent asked NOTHING (it narrated or decided out loud). Defaults to a bare go-ahead. */
  nudge?: string;
  /**
   * After this many answered questions the author stops answering and PUSHES: "that's enough, write it."
   * Without this the author only ever answers, so a run can only ever test "does the agent converge
   * unprompted?" — never "can it reach the gate with a cooperative author?", which is the question that
   * matters. A real author runs out of patience; the fixture must too.
   */
  pushAfter?: number;
  /** What the author says once pushing. */
  push?: string;
  /** Ordered rules — first match wins. */
  keyed?: { match: string; answer: string }[];
}

export interface AuthorLog {
  question: string;
  answer: string;
  matched: string | null;   // the pattern that fired, or null when the default was used
  alsoMatched?: string[];   // other patterns that also hit — a sign the rules overlap
  repeat?: boolean;         // this rule already fired earlier: the agent re-asked something it was told
}

/**
 * Pull the INTERROGATIVE part out of an agent message.
 *
 * The agent's turn is usually recap + question: "A Scottish island, present day — and the automation crew
 * is three weeks out. That gives us a countdown… Now, who is she?" Matching the whole message means the
 * agent's own ECHO of the previous answer re-triggers the rule that produced it, so the author repeats
 * itself forever while the agent (correctly) protests that it already heard that. Matching only the
 * question sentences fixes it: recaps are declarative, asks are interrogative.
 *
 * Returns "" when the message asks NOTHING. That case is real and distinct: the agent is narrating or
 * deciding out loud, not interviewing. Falling back to the whole text there makes a topic-noun rule fire
 * on the narration and answers a non-question with a fact — noise the agent then has to reconcile.
 */
export function questionsIn(text: string): string {
  const qs = text.match(/[^.!?\n]*\?/g);
  if (!qs?.length) return "";
  return qs.slice(-4).join(" "); // agents often stack 2–3 asks; the last few are the live ones
}

export class Author {
  readonly log: AuthorLog[] = [];
  private readonly fired = new Set<string>();
  private get answered(): number { return this.log.filter((l) => l.matched !== "(push)").length; }
  constructor(private readonly script: ScriptedAuthor) {}

  answer(rawQuestion: string): string {
    const question = questionsIn(rawQuestion);
    // Patience exhausted — stop feeding the interview and ask for the artifact. Logged distinctly so a run
    // that only reached the gate AFTER being told to is not confused with one that got there on its own.
    const limit = this.script.pushAfter;
    if (limit !== undefined && this.answered >= limit) {
      const push = this.script.push ?? "That's enough questions — write the logline and the premise now, using what I've told you.";
      this.log.push({ question: question || "(no question asked)", answer: push, matched: "(push)" });
      return push;
    }
    // The agent asked nothing — it's narrating or deciding. A real author would say "yes, go on", not
    // volunteer a fact. Counted separately from fallbacks: this is the agent not asking, not the fixture
    // failing to cover a question.
    if (!question.trim()) {
      const nudge = this.script.nudge ?? "That sounds right — go ahead.";
      this.log.push({ question: "(no question asked)", answer: nudge, matched: "(nudge)" });
      return nudge;
    }
    const hits = (this.script.keyed ?? []).filter((r) => new RegExp(r.match, "i").test(question));
    if (!hits.length) {
      this.log.push({ question, answer: this.script.default, matched: null });
      return this.script.default;
    }
    // Prefer a rule that hasn't fired yet: when several match, the agent is far more likely to be asking
    // the NEW thing than re-asking the one it already has an answer for.
    const fresh = hits.filter((r) => !this.fired.has(r.match));
    const ordered = fresh.length ? [...fresh, ...hits.filter((r) => this.fired.has(r.match))] : hits;
    const [rule, ...rest] = ordered;
    const entry: AuthorLog = { question, answer: rule.answer, matched: rule.match };
    // Overlapping rules mean the first-match-wins order is doing real work — which is fragile. Record it
    // so a noisy fixture is visible rather than silently deciding the run.
    if (rest.length) entry.alsoMatched = rest.map((r) => r.match);
    // A repeat is the agent re-asking something the author already answered. That is a finding about the
    // AGENT (it isn't retaining), not about the fixture — surface it, don't hide it.
    if (this.fired.has(rule.match)) entry.repeat = true;
    this.fired.add(rule.match);
    this.log.push(entry);
    return rule.answer;
  }

  /** Questions that fell through to the default — high values mean the fixture under-specifies. */
  get fallbackUses(): number { return this.log.filter((l) => l.matched === null).length; }
  /** Turns where the agent asked nothing at all — it was narrating, not interviewing. */
  get nudges(): number { return this.log.filter((l) => l.matched === "(nudge)").length; }
  /** Turns where the author had to DEMAND the artifact rather than answer. >0 means it did not self-converge. */
  get pushes(): number { return this.log.filter((l) => l.matched === "(push)").length; }
  /** Answers the agent had already been given — evidence it is re-asking rather than retaining. */
  get repeats(): number { return this.log.filter((l) => l.repeat).length; }
  /** Questions where more than one rule matched — evidence the fixture's patterns overlap. */
  get ambiguous(): number { return this.log.filter((l) => l.alsoMatched?.length).length; }
  get questionCount(): number { return this.log.length; }
}
