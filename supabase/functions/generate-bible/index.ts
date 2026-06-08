// generate-bible — seed or extract a book's "bible" (established facts).
//
// The bible is layer A of generation context: characters, world, style — the truth every
// page must stay consistent with. Two sources, two jobs:
//   source="brief"      → draft a FIRST version from the brief alone (Opus). For a book with
//                         little/no prose yet; invents sensible specifics to edit.
//   source="manuscript" → EXTRACT the bible from the actual prose (Haiku, cheap/fast). Reads
//                         the whole book and records only what the manuscript establishes.
// Either way it produces markdown text the author reviews before saving (books.bible.text). The
// draft is persisted as a book_generations task row (not returned inline) so a refresh resumes the
// loader and the pending draft survives until the author accepts or discards it.
//
//   client → POST { bookId, source? }
//     → verify edit access
//     → INSERT book_generations { kind:'bible', status:'running', input:{source} }  ← returned ~1s
//     → background: Claude → UPDATE row { status:'ready', result:{text} }
//     → client watches book_generations via Realtime
//
// Needs the ANTHROPIC_API_KEY secret (shared with the other generation functions).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { runInBackground, serviceClient } from "../_shared/task.ts";
import { callClaude as callClaudeApi, type CallMeta } from "../_shared/claude.ts";
import { tiptapToText } from "../_shared/words.ts";

const BRIEF_MODEL = "claude-opus-4-7";              // drafting from the brief — richer invention
const SCAN_MODEL = "claude-haiku-4-5-20251001";     // extracting from prose — cheap/fast over the whole book
const PER_PAGE_PROSE_CAP = 8000;                    // chars; very long pages are truncated to bound the prompt

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

interface PageRow {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  content: unknown;
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

    const { bookId, source = "brief" } = (await req.json().catch(() => ({}))) as {
      bookId?: number;
      source?: "brief" | "manuscript";
    };
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

    const bookName = book.name;
    const brief = book.brief as Brief | null;

    // For a manuscript scan, fetch the prose up front so an empty book fails fast (400) rather than
    // creating a task row that errors in the background.
    let pages: PageRow[] | null = null;
    if (source === "manuscript") {
      const { data, error: pagesError } = await userClient
        .from("pages")
        .select("id, page_index, page_type, title, content")
        .eq("book_id", bookId)
        .eq("archived", false)
        .order("page_index", { ascending: true });
      if (pagesError) throw new Error(`fetch pages: ${pagesError.message}`);
      if (!data || data.length === 0) return json({ error: "Book has no pages to scan" }, 400);
      pages = data as PageRow[];
    }

    const service = serviceClient();
    const { data: gen, error: insertError } = await service
      .from("book_generations")
      .insert({ book_id: bookId, created_by: user.id, kind: "bible", scope: "book", status: "running", input: { source } })
      .select()
      .single();
    if (insertError || !gen) return json({ error: "Could not start bible draft" }, 500);

    runInBackground(service, "book_generations", gen.id, "generate-bible", async () => {
      const meta: CallMeta = { fn: "generate-bible", bookId, taskTable: "book_generations", taskId: gen.id, userId: user.id };
      const text = source === "manuscript"
        ? await scanFromManuscript(apiKey, bookName, brief, pages!, meta)
        : await draftFromBrief(apiKey, bookName, brief, meta);
      return { status: "ready", result: { text } };
    });

    return json({ status: "running", generation: gen }, 202);
  } catch (e) {
    console.error("generate-bible error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// ── Shared output shape ────────────────────────────────────────────────────────
const SECTIONS = `## Premise
## Characters        (name — role; their want, their wound/flaw; voice in one line)
## World & Setting   (time, place, rules/constraints that matter)
## Style & Voice     (POV, tense, tone, diction notes)
## Names & Terms     (proper nouns to keep consistent)`;

// ── Brief draft (Opus): invent a coherent first version from the brief ─────────
const BRIEF_SYSTEM = `You are a story bible editor. From an author's brief, draft the book's
"bible" — the established facts every page must stay consistent with. Output MARKDOWN
(not JSON), concise and scannable, with these sections (omit any that don't apply to the
genre):

${SECTIONS}

Keep it a reference, not prose — bullet points and short lines. Invent sensible specifics
where the brief is silent, so the author has something concrete to edit. No preamble.`;

// ── Manuscript scan (Haiku): extract only what the prose actually establishes ──
const SCAN_SYSTEM = `You are a story bible editor reading a book's ACTUAL prose. Extract its
"bible" — the established facts every page must stay consistent with — from what the
manuscript itself sets down: character names and traits, places, rules, recurring terms, and
the narrative voice as written. Output MARKDOWN (not JSON), concise and scannable, with these
sections (omit any the manuscript doesn't establish):

${SECTIONS}

Record ONLY what the prose actually establishes — do NOT invent or extrapolate. Where the
manuscript is silent, leave it out. Prefer the book's own words for names and terms. Keep it a
reference — bullet points and short lines. No preamble.`;

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

// The book as title + prose per page, in reading order (sections become headings).
function bookContext(pages: PageRow[]): string {
  return pages
    .map((p) => {
      if (p.page_type === "section") return `\n# ${p.title || "(untitled section)"}`;
      const prose = tiptapToText(p.content).trim();
      const body = prose ? prose.slice(0, PER_PAGE_PROSE_CAP) : "(no prose yet)";
      return `## ${p.title || "(untitled)"}\n${body}`;
    })
    .join("\n\n");
}

async function draftFromBrief(apiKey: string, bookName: string, brief: Brief | null, meta: CallMeta): Promise<string> {
  return callClaude(apiKey, BRIEF_MODEL, BRIEF_SYSTEM, [
    { role: "user", content: `BOOK: ${bookName}\n\nBRIEF:\n${briefContext(brief)}\n\nDraft the bible. Markdown only.` },
  ], meta);
}

async function scanFromManuscript(
  apiKey: string,
  bookName: string,
  brief: Brief | null,
  pages: PageRow[],
  meta: CallMeta
): Promise<string> {
  return callClaude(apiKey, SCAN_MODEL, SCAN_SYSTEM, [
    {
      role: "user",
      content:
        `BOOK: ${bookName}\n\nBRIEF (light context — defer to the prose where they differ):\n${briefContext(brief)}` +
        `\n\nTHE MANUSCRIPT:\n${bookContext(pages)}` +
        `\n\nExtract the bible from what the prose establishes. Markdown only.`,
    },
  ], meta);
}

async function callClaude(
  apiKey: string,
  model: string,
  system: string,
  messages: { role: "user"; content: string }[],
  meta: CallMeta
): Promise<string> {
  const data = await callClaudeApi(apiKey, {
    model,
    max_tokens: 4000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
  }, meta);

  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no text content.");
  return text;
}
