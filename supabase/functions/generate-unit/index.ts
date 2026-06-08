// generate-unit — render prose from an objective, with book context (the "render(objective)
// → prose" step). Synchronous (a paragraph/page is quick), unlike evaluate-book's job.
//
//   client → POST { bookId, pageId, level, objective, ... }
//     → verify edit access
//     → generateUnit (shared core: brief + objective map + preceding prose → Claude)
//     → { text }
//
// The context-building + Claude logic lives in _shared/generate-unit-core.ts so it can be reused by
// the async orchestrators (generate-page, generate-book, build-revision). This function keeps the
// synchronous HTTP contract its callers (paragraph-level, dev parity) still rely on.
//
// Needs the ANTHROPIC_API_KEY secret (shared with evaluate-book / generate-scaffold).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { generateUnit, type ReviseIssue } from "../_shared/generate-unit-core.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface GenerateRequest {
  bookId: number;
  pageId: number;
  level: "paragraph" | "page";
  objective: string;
  pageObjective?: string;
  precedingText?: string;
  mode?: "write" | "revise";
  issues?: ReviseIssue[];
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

    // Book + access check (owner or accepted collaborator — mirrors evaluate-book).
    const { data: book, error: bookError } = await userClient
      .from("books")
      .select("id, owner_id")
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

    const text = await generateUnit(userClient, apiKey, {
      bookId,
      pageId: body.pageId ?? null,
      level,
      objective: body.objective,
      pageObjective: body.pageObjective,
      precedingText: body.precedingText,
      mode: body.mode,
      issues: body.issues,
      userId: user.id,
    });

    return json({ text });
  } catch (e) {
    console.error("generate-unit error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
