// revise-node — the signal-driven revise of a SHORT plan node (spine / objective / beat).
//
// The preserve path for the small layers: given the node's current text and an author instruction,
// rewrite it to honour the instruction while keeping what already works — the opposite of the
// re-create (expand/distill) transforms, which replace from a neighbour. Prose has its own heavier
// reviser (revise-prose); this handles the one-or-two-sentence / one-paragraph nodes.
//
//   client → POST { bookId, pageId?, layer, current, instruction } → verify edit access → { text }
//
// Synchronous. The client shows a diff and, on accept, writes the node back. Needs ANTHROPIC_API_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
import { callClaude, textFromClaude } from "../_shared/claude.ts";
import { getActiveModels } from "../_shared/model-config.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}

type Layer = "spine" | "objective" | "beat";

const SHAPE: Record<Layer, string> = {
  spine: "the BOOK SPINE — the throughline of the whole book, 1–2 short paragraphs naming its central aim and arc",
  objective: "a page OBJECTIVE — 1–2 sentences stating what that page must achieve (its job in the book)",
  beat: "a page BEAT — one paragraph planning, in order, what the page does to fulfil its objective",
};

function systemFor(layer: Layer): string {
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { bookId, layer, current, instruction } = (await req.json().catch(() => ({}))) as {
      bookId?: number; pageId?: number; layer?: Layer; current?: string; instruction?: string;
    };
    if (!bookId) return json({ error: "bookId is required" }, 400);
    if (layer !== "spine" && layer !== "objective" && layer !== "beat") return json({ error: "layer must be spine|objective|beat" }, 400);
    const cur = (current ?? "").trim();
    const instr = (instruction ?? "").trim();
    if (!cur) return json({ error: "There's nothing to revise yet" }, 400);
    if (!instr) return json({ error: "An instruction is required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, owner_id, brief, spine").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    if (!(await hasEditAccess(userClient, bookId, user.id, book.owner_id)))
      return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;
    const { high: model } = await getActiveModels();

    const data = await callClaude(apiKey, {
      model,
      max_tokens: 1024,
      system: [{ type: "text", text: systemFor(layer), cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content:
          `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(book.brief as Brief | null)}` +
          (spine && layer !== "spine" ? `\n\nBOOK SPINE:\n${spine}` : "") +
          `\n\nCURRENT ${layer.toUpperCase()}:\n${cur}` +
          `\n\nAUTHOR'S INSTRUCTION:\n${instr}` +
          `\n\nReturn the revised ${layer} only.`,
      }],
    }, { fn: "revise-node", bookId, userId: user.id });

    const text = textFromClaude(data).trim();
    if (!text) return json({ error: "Claude returned nothing." }, 502);

    return json({ text });
  } catch (e) {
    console.error("revise-node error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
