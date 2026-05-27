// generate-bible — seed a book's "bible" (established facts) from its brief.
//
// The bible is layer A of generation context: characters, world, style — the truth every
// page must stay consistent with. This proposes a first draft as markdown from the brief;
// the author then edits and saves it (books.bible.text). Returns text, does NOT write.
//
//   client → POST { bookId } → verify edit access → Claude → { text }
//
// Needs the ANTHROPIC_API_KEY secret (shared with the other generation functions).
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
      .select("id, name, brief, owner_id")
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

    const text = await callClaude(apiKey, book.name, book.brief as Brief | null);
    return json({ text });
  } catch (e) {
    console.error("generate-bible error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

const SYSTEM = `You are a story bible editor. From an author's brief, draft the book's
"bible" — the established facts every page must stay consistent with. Output MARKDOWN
(not JSON), concise and scannable, with these sections (omit any that don't apply to the
genre):

## Premise
## Characters        (name — role; their want, their wound/flaw; voice in one line)
## World & Setting   (time, place, rules/constraints that matter)
## Style & Voice     (POV, tense, tone, diction notes)
## Names & Terms     (proper nouns to keep consistent)

Keep it a reference, not prose — bullet points and short lines. Invent sensible specifics
where the brief is silent, so the author has something concrete to edit. No preamble.`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — invent a coherent book from a neutral premise)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — invent a coherent book)";
}

async function callClaude(apiKey: string, bookName: string, brief: Brief | null): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: `BOOK: ${bookName}\n\nBRIEF:\n${briefContext(brief)}\n\nDraft the bible. Markdown only.` },
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
  return text;
}
