// spine-core — the pure "brief → spine" and "brief → 3 alternative spines" workers, extracted so the
// sync endpoints (brief-to-spine, spine-options) AND the durable dispatcher (ai-run) share identical
// logic. No auth, no access check, no row writes — callers own those (mirrors options-core.ts).
import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callClaude, textFromClaude, type CallMeta } from "./claude.ts";
import { getActiveModels } from "./model-config.ts";
import { parseJsonOptions } from "./json.ts";
import { readSteer, steerBlock } from "./steer.ts";



export interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}

const GEN_SYSTEM = `You are a book architect writing the BOOK SPINE — the throughline of the whole book. In 1–2 short paragraphs, state what this book is fundamentally DOING: its central objective/promise and the arc from beginning to end. This is the book-level objective every page will serve.

Rules:
- Output 1–2 short paragraphs. No title, no heading, no preamble, no markdown, no meta commentary — just the spine.
- It is the structural throughline, NOT a blurb or marketing copy and NOT a chapter list. Name the central aim, the through-arc, and what changes by the end.
- Derive it from the brief (genre, audience, premise, tone). Honour them as the voice/intent contract.
- If an outline is given, stay consistent with it, but write the spine at the BOOK level — above any single page.`;

const OPTIONS_SYSTEM = `You are a book architect generating ALTERNATIVE SPINES from an author's brief.

A SPINE is the book's throughline: 1–2 short paragraphs stating what this book is fundamentally DOING — its central objective/promise and the arc from beginning to end. It is not a blurb or marketing copy. It names the central aim, the through-arc, and what changes by the end.

Generate exactly 3 ALTERNATIVES. Each must:
- Honor the brief (genre, audience, premise, tone, scope) as the non-negotiable contract
- Be GENUINELY DIFFERENT from each other — pull different threads from the premise, foreground different tensions, land on different emotional arcs
- Vary in register: one could be intimate and interior, one structural and external, one thematic/philosophical
- If a current spine is provided, vary away from it — don't paraphrase it

Output JSON ONLY (no prose, no fences):
{ "options": ["<1–2 paragraphs>", "<1–2 paragraphs>", "<1–2 paragraphs>"] }`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — infer a sensible neutral aim)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}${brief.scope.word_target ? ` (≈${brief.scope.word_target} words)` : ""}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible neutral aim)";
}

function outlineContext(pages: Array<{ page_type: string | null; title: string | null; metadata: { objective?: string } | null }>): string {
  return pages
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      if (p.page_type === "section") return `# ${p.title || "(untitled section)"}${obj ? ` — ${obj}` : ""}`;
      return `- "${p.title || "(untitled)"}"${obj ? ` — ${obj}` : ""}`;
    })
    .join("\n");
}

// deno-lint-ignore no-explicit-any
const textOf = (data: any): string => textFromClaude(data).trim();

// brief → the book spine (single throughline). Throws on no output.
export async function generateSpine(client: SupabaseClient, apiKey: string, p: { bookId: number; userId?: string | null }): Promise<string> {
  const { data: book, error } = await client.from("books").select("id, name, brief, steers").eq("id", p.bookId).single();
  if (error || !book) throw new Error("Book not found");
  const { data: pages } = await client.from("pages").select("page_type, title, metadata")
    .eq("book_id", p.bookId).eq("archived", false).order("page_index", { ascending: true });
  const outline = (pages as Array<{ page_type: string | null; title: string | null; metadata: { objective?: string } | null }>) ?? [];

  const { high: model } = await getActiveModels();
  const meta: CallMeta = { fn: "brief-to-spine", bookId: p.bookId, userId: p.userId ?? null };
  const data = await callClaude(apiKey, {
    model,
    max_tokens: 1024,
    system: [{ type: "text", text: GEN_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `BOOK: ${book.name}\n\nBRIEF (the voice/intent contract):\n${briefContext(book.brief as Brief | null)}` +
        (outline.length ? `\n\nCURRENT OUTLINE (for consistency — write the spine ABOVE these):\n${outlineContext(outline)}` : "") +
        steerBlock(readSteer(book.steers, "spine")) +
        `\n\nWrite the book spine. 1–2 short paragraphs, the throughline only.`,
    }],
  }, meta);
  const spine = textOf(data);
  if (!spine) throw new Error("Claude returned no spine.");
  return spine;
}

// brief → 3 wide alternative spines. Throws on no output.
export async function spineOptions(client: SupabaseClient, apiKey: string, p: { bookId: number; userId?: string | null }): Promise<string[]> {
  const { data: book, error } = await client.from("books").select("id, name, brief, spine, steers").eq("id", p.bookId).single();
  if (error || !book) throw new Error("Book not found");
  const current = (book.spine as { text?: string } | null)?.text?.trim() || null;

  const { high: model } = await getActiveModels();
  const meta: CallMeta = { fn: "spine-options", bookId: p.bookId, userId: p.userId ?? null };
  const data = await callClaude(apiKey, {
    model,
    max_tokens: 2048,
    temperature: 1,
    system: [{ type: "text", text: OPTIONS_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(book.brief as Brief | null)}` +
        (current ? `\n\nCURRENT SPINE (what's there now — vary away from it):\n${current}` : "\n\n(No spine set yet.)") +
        steerBlock(readSteer(book.steers, "spine")) +
        `\n\nGenerate 3 wide-varying alternative spines. JSON only.`,
    }],
  }, meta);
  const text = textOf(data);
  if (!text) throw new Error("Claude returned no options.");
  const options = parseJsonOptions(text);
  if (options.length === 0) throw new Error("Claude returned an empty options list.");
  return options;
}
