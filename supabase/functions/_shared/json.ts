// json.ts — tolerant JSON extraction from LLM replies, shared by every parser that reads a model's
// JSON output. Models sometimes wrap JSON in ```fences``` or surround it with a stray line of prose
// despite "JSON only" instructions; these helpers strip a reply down to its JSON payload. One
// implementation so the guardrails can't drift — they had, across ~12 hand-copied variants.

/**
 * Strip a model reply down to its JSON payload: prefer a ```json fenced block, else the span from
 * the first opening bracket to the last closing one. Handles both objects {…} and arrays […].
 * Returns the raw JSON string (caller still does JSON.parse, so parse errors stay at the call site).
 * Applies a light repair pass for the most common LLM slip: unescaped double-quotes inside strings.
 */
export function extractJsonBlock(text: string): string {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.search(/[{[]/);
    const last = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  return repairUnescapedQuotes(raw);
}

/**
 * Escape double-quotes that appear INSIDE a JSON string value but were not escaped by the model.
 * Walks character-by-character; a quote inside a string is "closing" only if the next non-whitespace
 * character is a JSON structural token (: , } ]) or end-of-input — otherwise it gets a backslash.
 * Already-escaped sequences (\") are passed through untouched.
 */
function repairUnescapedQuotes(json: string): string {
  let result = "";
  let inString = false;
  let i = 0;
  while (i < json.length) {
    const ch = json[i];
    if (ch === "\\" && inString) {
      result += ch + (json[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += ch;
        i++;
        continue;
      }
      // Inside a string: look past whitespace to decide if this is the closing quote.
      let j = i + 1;
      while (j < json.length && " \t\n\r".includes(json[j])) j++;
      const next = json[j];
      if (next === ":" || next === "," || next === "}" || next === "]" || j >= json.length) {
        inString = false;
        result += ch;
      } else {
        result += '\\"';
      }
      i++;
      continue;
    }
    result += ch;
    i++;
  }
  return result;
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
