// revise-core — the pure "revise a SHORT plan node (spine/objective/beat) against an instruction"
// worker, extracted so the sync endpoint (revise-node) AND the durable dispatcher (ai-run) share
// identical logic. No auth, no access check, no row writes — callers own those.
import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callClaude, textFromClaude, type CallMeta } from "./claude.ts";
import { getActiveModels } from "./model-config.ts";

export type ReviseLayer = "spine" | "objective" | "beat";

interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}

const SHAPE: Record<ReviseLayer, string> = {
  spine: "the BOOK SPINE — the throughline of the whole book, 1–2 short paragraphs naming its central aim and arc",
  objective: "a page OBJECTIVE — 1–2 sentences stating what that page must achieve (its job in the book)",
  beat: "a page BEAT — one paragraph planning, in order, what the page does to fulfil its objective",
};

function systemFor(layer: ReviseLayer): string {
  return `You are revising ${SHAPE[layer]}. Apply the author's INSTRUCTION while PRESERVING what already works — change only what the instruction asks for, keep the rest. This is a revision, not a rewrite from scratch.

Rules:
- Output only the revised ${layer}. No title, no heading, no preamble, no markdown, no meta commentary, no list of changes.
- Keep the same kind of statement and length as the original (it is ${SHAPE[layer]}).
- Honour the book's brief (genre, audience, tone) and stay consistent with the book spine if given.`;
}

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set)";
  const lines: string[] = [];
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  return lines.length ? lines.join("\n") : "(brief is empty)";
}

export interface ReviseParams {
  bookId: number;
  layer: ReviseLayer;
  current: string;
  instruction: string;
  userId?: string | null;
}

// Revise the node; returns the proposed text. Throws on bad input / no output.
export async function reviseNode(client: SupabaseClient, apiKey: string, p: ReviseParams): Promise<string> {
  if (p.layer !== "spine" && p.layer !== "objective" && p.layer !== "beat") throw new Error("layer must be spine|objective|beat");
  const cur = (p.current ?? "").trim();
  const instr = (p.instruction ?? "").trim();
  if (!cur) throw new Error("There's nothing to revise yet");
  if (!instr) throw new Error("An instruction is required");

  const { data: book, error } = await client.from("books").select("id, name, brief, spine").eq("id", p.bookId).single();
  if (error || !book) throw new Error("Book not found");
  const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;

  const { high: model } = await getActiveModels();
  const meta: CallMeta = { fn: "revise-node", bookId: p.bookId, userId: p.userId ?? null };
  const data = await callClaude(apiKey, {
    model,
    max_tokens: 1024,
    system: [{ type: "text", text: systemFor(p.layer), cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(book.brief as Brief | null)}` +
        (spine && p.layer !== "spine" ? `\n\nBOOK SPINE:\n${spine}` : "") +
        `\n\nCURRENT ${p.layer.toUpperCase()}:\n${cur}` +
        `\n\nAUTHOR'S INSTRUCTION:\n${instr}` +
        `\n\nReturn the revised ${p.layer} only.`,
    }],
  }, meta);
  const text = textFromClaude(data).trim();
  if (!text) throw new Error("Claude returned nothing.");
  return text;
}
