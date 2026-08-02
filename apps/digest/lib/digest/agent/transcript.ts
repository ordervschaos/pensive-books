import type { Turn } from "../llm";

/** One thing the reader said, plus everything it caused. The display shape, derived — never stored. */
export interface Exchange {
  message: string;
  text?: string;
  steps: ExchangeStep[];
  error?: string;
}

export interface ExchangeStep {
  tool: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
}

/**
 * Fold the model transcript into what a reader sees: one exchange per thing they said, carrying the tool
 * calls it caused and the answer it ended with.
 *
 * Tool *results* are matched back to their calls by id, and only the failures are kept — a successful
 * result is a wall of text the reader has no reason to read, while a refusal is the whole story of why a
 * turn didn't do what it looks like it did.
 */
export function toExchanges(messages: Turn[]): Exchange[] {
  const results = new Map<string, string>();
  for (const turn of messages) {
    if (turn.role === "tool") results.set(turn.toolCallId, turn.content);
  }

  const exchanges: Exchange[] = [];
  for (const turn of messages) {
    if (turn.role === "user") {
      exchanges.push({ message: turn.content, steps: [] });
      continue;
    }
    if (turn.role !== "assistant") continue;
    const current = exchanges[exchanges.length - 1];
    if (!current) continue;

    for (const call of turn.toolCalls ?? []) {
      const result = results.get(call.id) ?? "";
      const step: ExchangeStep = {
        tool: call.name,
        input: call.input,
        result,
        isError: result.startsWith("Error:") || result.includes("changed while you were working"),
      };
      current.steps.push(step);
    }
    if (turn.content) current.text = turn.content;
  }
  return exchanges;
}
