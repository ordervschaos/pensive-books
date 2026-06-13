// json.ts — tolerant JSON extraction from LLM replies, shared by every parser that reads a model's
// JSON output. Models sometimes wrap JSON in ```fences``` or surround it with a stray line of prose
// despite "JSON only" instructions; these helpers strip a reply down to its JSON payload. One
// implementation so the guardrails can't drift — they had, across ~12 hand-copied variants.

/**
 * Strip a model reply down to its JSON payload: prefer a ```json fenced block, else the span from
 * the first opening bracket to the last closing one. Handles both objects {…} and arrays […].
 * Returns the raw JSON string (caller still does JSON.parse, so parse errors stay at the call site).
 */
export function extractJsonBlock(text: string): string {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const first = raw.search(/[{[]/);
  const last = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  return raw;
}

/**
 * Parse an "options" reply into a clean string list. Accepts either a bare array `["…","…"]` or an
 * `{ "options": ["…"] }` object. Returns trimmed, non-empty strings. Throws on unparseable JSON.
 */
export function parseJsonOptions(text: string): string[] {
  const parsed = JSON.parse(extractJsonBlock(text));
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : (Array.isArray((parsed as { options?: unknown })?.options) ? (parsed as { options: unknown[] }).options : []);
  return arr.map((s) => String(s).trim()).filter(Boolean);
}
