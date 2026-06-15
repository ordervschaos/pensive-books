// revise-core — revise ANY named node against an instruction, preserving what already works.
// Shared by the sync revise-node endpoint and the durable ai-run dispatcher. No auth, no row writes.
import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { type Brief, briefContext } from "./brief.ts";
import { callClaude, textFromClaude, type CallMeta } from "./claude.ts";
import { getActiveModels } from "./model-config.ts";
import { settledContext, type Foundations } from "./foundations-core.ts";

export type ReviseLayer =
  | "spine" | "objective" | "beat"
  | "argument" | "ending" | "tentpole" | "voice"
  | "prose";

const VALID_LAYERS: readonly ReviseLayer[] = [
  "spine", "objective", "beat", "argument", "ending", "tentpole", "voice", "prose",
];

const SHAPE: Record<ReviseLayer, string> = {
  spine: "the BOOK SPINE — the throughline of the whole book, 1–2 short paragraphs naming its central aim and arc",
  objective: "a page OBJECTIVE — 1–2 sentences stating what that page must achieve (its job in the book)",
  beat: "a page BEAT — one paragraph planning, in order, what the page does to fulfil its objective",
  argument: "the ARGUMENT — the central claim or thematic truth the whole book argues",
  ending: "the ENDING — where the story ultimately lands, resolving the argument",
  tentpole: "a TENTPOLE MOMENT — a single must-have story beat the structure pivots around",
  voice: "a VOICE EXEMPLAR — a ~120-word passage that establishes the book's prose register",
  prose: "the PAGE PROSE — the actual written prose for this scene or chapter",
};

function systemFor(layer: ReviseLayer): string {
  const isProse = layer === "prose";
  return `You are revising ${SHAPE[layer]}. Apply the author's INSTRUCTION while PRESERVING what already works — change only what the instruction asks for, keep the rest. This is a revision, not a rewrite from scratch.

Rules:
- Output only the revised ${layer}. No title, no heading, no preamble, no markdown, no meta commentary, no list of changes.
${isProse
  ? "- Keep the same approximate length and structure as the original unless the instruction asks otherwise.\n- Preserve POV, tense, and established voice."
  : `- Keep the same kind of statement and length as the original (it is ${SHAPE[layer]}).`}
- Honour the book's brief (genre, audience, tone) and stay consistent with the book spine if given.`;
}

export interface ReviseParams {
  bookId: number;
  layer: ReviseLayer;
  current: string;
  instruction: string;
  pageId?: number;        // required for prose context assembly
  userId?: string | null;
}

export async function reviseNode(client: SupabaseClient, apiKey: string, p: ReviseParams): Promise<string> {
  if (!VALID_LAYERS.includes(p.layer)) throw new Error(`layer must be one of: ${VALID_LAYERS.join("|")}`);
  const cur = (p.current ?? "").trim();
  const instr = (p.instruction ?? "").trim();
  if (!cur) throw new Error("There's nothing to revise yet");
  if (!instr) throw new Error("An instruction is required");

  const needsFoundations = p.layer === "ending" || p.layer === "tentpole" || p.layer === "voice";
  const selectFields = needsFoundations ? "id, name, brief, foundations" : "id, name, brief, spine";

  const { data: book, error } = await client.from("books").select(selectFields).eq("id", p.bookId).single();
  if (error || !book) throw new Error("Book not found");

  const f = (book.foundations as Foundations | null) ?? {};
  const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;

  // Assemble layer-specific context.
  let contextBlock = "";
  if (p.layer === "ending") {
    if (f.argument?.text?.trim()) contextBlock = `\n\nBOOK ARGUMENT:\n${f.argument.text.trim()}`;
  } else if (p.layer === "tentpole" || p.layer === "voice") {
    contextBlock = `\n\nBOOK FOUNDATIONS:\n${settledContext(f)}`;
  } else if (p.layer === "prose") {
    if (spine) contextBlock += `\n\nBOOK SPINE:\n${spine}`;
    if (p.pageId) {
      const { data: page } = await client.from("pages").select("metadata").eq("id", p.pageId).single();
      const m = (page?.metadata as Record<string, unknown> | null) ?? {};
      const obj = (m.objective as string | null)?.trim() || "";
      const beat = (m.beat as string | null)?.trim() || "";
      if (obj) contextBlock += `\n\nPAGE OBJECTIVE:\n${obj}`;
      if (beat) contextBlock += `\n\nPAGE BEAT:\n${beat}`;
    }
  } else if (spine && p.layer !== "spine") {
    // spine / objective / beat: add book spine for layers below it
    contextBlock = `\n\nBOOK SPINE:\n${spine}`;
  }

  const { high: model } = await getActiveModels();
  const meta: CallMeta = { fn: "revise-node", bookId: p.bookId, userId: p.userId ?? null };
  const data = await callClaude(apiKey, {
    model,
    max_tokens: p.layer === "prose" ? 4096 : 1024,
    system: [{ type: "text", text: systemFor(p.layer), cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content:
        `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(book.brief as Brief | null, { scope: "none", success: false, none: "(no brief set)", empty: "(brief is empty)" })}` +
        contextBlock +
        `\n\nCURRENT ${p.layer.toUpperCase()}:\n${cur}` +
        `\n\nAUTHOR'S INSTRUCTION:\n${instr}` +
        `\n\nReturn the revised ${p.layer} only.`,
    }],
  }, meta);
  const text = textFromClaude(data).trim();
  if (!text) throw new Error("Claude returned nothing.");
  return text;
}
