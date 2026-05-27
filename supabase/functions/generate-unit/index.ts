// generate-unit — render prose from an objective (the "render(objective) → prose" step).
//
// Given a unit's objective + the book's brief (voice/genre/tone), Claude writes the prose
// that fulfills it. Synchronous (a paragraph/page is quick), unlike evaluate-book's
// background job:
//
//   client → POST { bookId, pageId, level, objective, ... }
//     → verify caller can edit the book
//     → fetch brief for voice/context
//     → Claude → { text }   (plain prose; client inserts it into the editor)
//
// Needs the ANTHROPIC_API_KEY secret (already set; shared with evaluate-book).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const MODEL = "claude-opus-4-7"; // quality-first for prose; switch to sonnet to cut cost at volume

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}

interface GenerateRequest {
  bookId: number;
  pageId: number;
  level: "paragraph" | "page";
  objective: string;        // the unit's objective (authoritative from the live editor)
  pageObjective?: string;   // parent page objective (paragraph level context)
  precedingText?: string;   // a little preceding prose, for continuity
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

    const body = (await req.json().catch(() => ({}))) as Partial<GenerateRequest>;
    const { bookId, level, objective } = body;
    if (!bookId) return json({ error: "bookId is required" }, 400);
    if (level !== "paragraph" && level !== "page") return json({ error: "level must be 'paragraph' or 'page'" }, 400);
    if (!objective || !objective.trim()) return json({ error: "objective is required" }, 400);

    // Book + access check (owner or accepted collaborator — mirrors evaluate-book).
    const { data: book, error: bookError } = await userClient
      .from("books")
      .select("id, name, subtitle, author, brief, owner_id")
      .eq("id", bookId)
      .single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access")
      .select("id")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .eq("status", "accepted")
      .maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const text = await callClaude(apiKey, {
      brief: book.brief as Brief | null,
      bookName: book.name,
      level,
      objective: objective.trim(),
      pageObjective: body.pageObjective?.trim() || null,
      precedingText: body.precedingText?.trim() || null,
    });

    return json({ text });
  } catch (e) {
    console.error("generate-unit error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// ── Prompt assembly ──────────────────────────────────────────────────────────
const SYSTEM = `You are a skilled prose writer helping an author render their book.
The author works in OBJECTIVES: a short statement of what a unit of the book must achieve.
Your job is to write the prose that achieves the given objective, in the book's voice.

Rules:
- Write ONLY the prose. No preamble, no headings, no markdown fences, no meta commentary.
- Honor the book's brief — genre, audience, tone, premise — as the voice contract.
- Serve the objective precisely; do not wander beyond what it asks.
- Match the requested length: a single paragraph means ONE paragraph.`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — infer a sensible neutral voice)";
  const lines: string[] = [];
  const b = brief.scope?.band;
  if (b) lines.push(`- Scope: ${b}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible neutral voice)";
}

function buildUserPrompt(args: {
  brief: Brief | null;
  bookName: string;
  level: "paragraph" | "page";
  objective: string;
  pageObjective: string | null;
  precedingText: string | null;
}): string {
  const parts: string[] = [
    `BOOK: ${args.bookName}`,
    `\nBRIEF (the voice contract):\n${briefContext(args.brief)}`,
  ];
  if (args.pageObjective) parts.push(`\nThis paragraph sits on a page whose objective is: ${args.pageObjective}`);
  if (args.precedingText) parts.push(`\nThe prose immediately before this unit (continue naturally, do not repeat it):\n"""\n${args.precedingText}\n"""`);
  parts.push(
    args.level === "paragraph"
      ? `\nWrite ONE paragraph that achieves this objective:\n${args.objective}`
      : `\nWrite the prose for a page that achieves this objective (multiple paragraphs as needed):\n${args.objective}`
  );
  return parts.join("\n");
}

// ── Claude call ──────────────────────────────────────────────────────────────
async function callClaude(
  apiKey: string,
  args: {
    brief: Brief | null;
    bookName: string;
    level: "paragraph" | "page";
    objective: string;
    pageObjective: string | null;
    precedingText: string | null;
  }
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: args.level === "page" ? 4000 : 600,
      // System writing instructions are stable across calls → cache them.
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserPrompt(args) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no text content.");
  return text;
}
