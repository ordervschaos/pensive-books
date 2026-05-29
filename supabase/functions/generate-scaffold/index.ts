// generate-scaffold — propose a book's objective tree from its brief (G2 / Step 1).
//
// Given books.brief, Claude designs a chapter/page scaffold: section (chapter) + text
// pages, each with a title and an OBJECTIVE (what it must achieve) — NO prose. The
// proposal is RETURNED, not written: the author reviews the plan (the high-value step)
// and the client creates the pages on confirm.
//
//   client → POST { bookId } → verify edit access → Claude → { structure, pages[] }
//
// Needs the ANTHROPIC_API_KEY secret (shared with evaluate-book / generate-unit).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const MODEL = "claude-opus-4-7";

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

    const { bookId } = (await req.json().catch(() => ({}))) as { bookId?: number };
    if (!bookId) return json({ error: "bookId is required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books")
      .select("id, name, subtitle, brief, bible, owner_id")
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

    const scaffold = await callClaude(
      apiKey,
      book.name,
      book.brief as Brief | null,
      (book.bible as { text?: string } | null)?.text?.trim() || null
    );
    return json(scaffold);
  } catch (e) {
    console.error("generate-scaffold error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// ── Prompt ───────────────────────────────────────────────────────────────────
const SYSTEM = `You are a book architect. Given an author's brief, design the book's
SCAFFOLD — its chapters and pages — as objectives, not prose.

Choose a structure appropriate to the genre and scope (e.g. Save the Cat or the Hero's
Journey for commercial fiction; the Fichtean curve for thrillers; a five-part arc for
self-help; a curated arc for memoir). Lay the book out as an ordered list of pages:
- "section" pages are chapter/part dividers (a title; an objective is optional).
- "text" pages are where prose will go; each MUST have a concise objective stating what
  that page must achieve (the beat it delivers, in one sentence).

Keep the size proportional to the scope: a short story is a handful of text pages; a novel
is chapters (section pages) each followed by several text pages.

Output JSON ONLY (no prose, no fences), exactly:
{
  "structure": "<the structure you chose>",
  "pages": [
    { "pageType": "section", "title": "Chapter 1 — ...", "objective": "" },
    { "pageType": "text", "title": "...", "objective": "..." }
  ]
}`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — infer a sensible book from a neutral premise)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}${brief.scope.word_target ? ` (≈${brief.scope.word_target} words)` : ""}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible book)";
}

interface ScaffoldPage { pageType: "section" | "text"; title: string; objective?: string }
interface Scaffold { structure: string; pages: ScaffoldPage[] }

async function callClaude(apiKey: string, bookName: string, brief: Brief | null, bible: string | null): Promise<Scaffold> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `BOOK: ${bookName}\n\nBRIEF:\n${briefContext(brief)}${bible ? `\n\nBOOK BIBLE (established facts — characters, world, style):\n${bible}` : ""}\n\nDesign the scaffold. JSON only.`,
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 500)}`);

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no text content.");
  return parseScaffold(text);
}

function parseScaffold(text: string): Scaffold {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  let parsed: Scaffold;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Could not parse scaffold JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    throw new Error("Scaffold has no pages.");
  }
  // Sanitize: keep only valid page shapes.
  parsed.pages = parsed.pages
    .filter((p) => p && (p.pageType === "section" || p.pageType === "text") && typeof p.title === "string")
    .map((p) => ({ pageType: p.pageType, title: p.title.trim(), objective: (p.objective ?? "").trim() }));
  return { structure: String(parsed.structure ?? "").trim(), pages: parsed.pages };
}
