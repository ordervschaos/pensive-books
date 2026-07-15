// research.ts — the web-research core, shared by the dna-research edge fn (option B: precompute a
// research pass → craft_notes) and the book-agent's research_web tool (option A: inline mid-turn).
//
// ONE Anthropic web_search call that searches the live web and DISTILLS to a few concrete, usable craft
// constraints. The distillation is the whole point: a raw search for "how to write a vampire hook" returns
// SEO listicle sludge that, fed into generation, makes prose MORE clichéd, not less. The system prompt
// reframes away from generic how-to advice toward reference/genre material a generator can actually honor,
// and ranks by source quality.
//
// Pinned to an Anthropic model on purpose: web_search is an Anthropic SERVER tool — it runs the search +
// citation server-side and returns results in the same call, so no external search API / new key is needed
// (ANTHROPIC_API_KEY already backs every other Anthropic call here). A bare claude-* id routes to Anthropic
// through llm.ts even while the active tier is DeepSeek: deepseek can't serve claude ids (wireModelFor →
// null), so resolveRoute falls back through the model's native anthropic order → the passthrough branch,
// which sends the body (incl. the server-tool def) to Anthropic unchanged.
import { callLLM, textFromLLM, type CallMeta } from "./llm.ts";

// web_search_20260209 = the dynamic-filtering variant (Opus 4.8/4.7/4.6, Sonnet 5/4.6). No beta header is
// required — anthropic-version 2023-06-01 (llm.ts already sends it) is sufficient. max_uses bounds the
// server-side search loop so a single research question can't run away (or trip pause_turn).
const RESEARCH_MODEL = "claude-opus-4-8";
const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 5 };

export interface ResearchSource { title: string; url: string }
export interface ResearchResult { notes: string; sources: ResearchSource[] }

const SYSTEM =
  `You are a story-craft researcher for a working novelist. Given a research question you SEARCH the web and return a SHORT, USABLE brief — not an essay, not a listicle.

WHAT TO RETURN (this is the hard part — do it well):
- 3-6 CONCRETE, SPECIFIC craft constraints the writer can act on: genre conventions readers expect, what strong examples of this actually DO, canonical comps / tropes to honor or subvert, real reference facts (lore, period detail, terminology). Each as one tight bullet.
- Reference and exemplar material OVER generic advice. "Vampire openings that land tend to start on an ordinary human moment, then invert it (e.g. …)" beats "make your hook exciting."
- Rank by source quality — prefer craft authorities, respected authors, and primary genre texts over SEO content farms. Silently discard vague, contradictory, or content-farm results; never pad to hit a count.

FORMAT: one line of takeaway, then the bullets. No preamble, no "here are some tips," no restating the question. If the web returns nothing usable, say exactly that in one line rather than inventing.`;

// One web_search-backed research call. Never assumes the search succeeds — an empty/failed search still
// returns whatever text the model produced (or a plain "no usable results" line). Sources are pulled from
// the web_search_tool_result blocks so callers can attach/show citations.
export async function researchCraft(
  { question, context }: { question: string; context?: string },
  meta: CallMeta,
  opts?: { signal?: AbortSignal },
): Promise<ResearchResult> {
  const data = await callLLM({
    model: RESEARCH_MODEL,
    max_tokens: 2000,
    output_config: { effort: "medium" },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [WEB_SEARCH_TOOL],
    messages: [{
      role: "user",
      content: `${context ? `CONTEXT (the book this is for):\n${context}\n\n` : ""}RESEARCH QUESTION:\n${question}\n\nSearch, then return the brief.`,
    }],
  }, meta, opts);

  const notes = textFromLLM(data).trim();
  // web_search results ride back as web_search_tool_result blocks whose .content is a LIST of
  // web_search_result {title,url,…} (an error is a single object instead — skip it). Dedup by url.
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();
  // deno-lint-ignore no-explicit-any
  for (const block of ((data?.content ?? []) as any[])) {
    if (block?.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const r of block.content) {
      if (r?.type === "web_search_result" && typeof r.url === "string" && !seen.has(r.url)) {
        seen.add(r.url);
        sources.push({ title: String(r.title ?? r.url), url: r.url });
      }
    }
  }
  return { notes: notes || "(no usable results)", sources };
}

// Render a research result as the compact text the agent reads back (tool_result) or that gets stored as a
// craft note — notes plus a short cited-sources tail so the writer can trace a claim.
export function renderResearch(r: ResearchResult): string {
  const src = r.sources.slice(0, 6).map((s) => `- ${s.title} — ${s.url}`).join("\n");
  return src ? `${r.notes}\n\nSOURCES:\n${src}` : r.notes;
}
