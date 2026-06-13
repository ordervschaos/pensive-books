// beat-to-prose — render a page's prose from its beat (or objective), with book context (the
// beat→prose edge of the resolution ladder). Synchronous (a paragraph/page is quick). Idempotent:
// an empty page creates, a written page re-renders (the caller overwrites). For REVISING existing
// prose against editorial notes, see revise-prose — a separate transform.
//
//   client → POST { bookId, pageId, level, objective, ... } → verify edit access → { text }
//
// The context-building + Claude logic lives in _shared/generate-unit-core.ts (beatToProse), reused by
// the orchestrators (generate-page, generate-book). Needs the ANTHROPIC_API_KEY secret.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
import { beatToProse } from "../_shared/generate-unit-core.ts";

interface GenerateRequest {
  bookId: number;
  pageId: number;
  level: "paragraph" | "page";
  objective: string;
  pageObjective?: string;
  precedingText?: string;
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
    const { bookId, level } = body;
    if (!bookId) return json({ error: "bookId is required" }, 400);
    if (level !== "paragraph" && level !== "page") return json({ error: "level must be 'paragraph' or 'page'" }, 400);

    // Book + access check (owner or accepted collaborator).
    const { data: book, error: bookError } = await userClient
      .from("books").select("id, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    if (!(await hasEditAccess(userClient, bookId, user.id, book.owner_id)))
      return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const text = await beatToProse(userClient, apiKey, {
      bookId,
      pageId: body.pageId ?? null,
      level,
      objective: body.objective,
      pageObjective: body.pageObjective,
      precedingText: body.precedingText,
      userId: user.id,
    });

    return json({ text });
  } catch (e) {
    console.error("beat-to-prose error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
