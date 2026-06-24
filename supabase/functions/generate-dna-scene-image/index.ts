// generate-dna-scene-image — illustrate ONE Novel-DNA scene node (picture-book mode, docs/picture-book-mode.md).
//
// The node-native sibling of generate-scene-image. That one is PAGE-bound (reads pages.metadata.beat, walks
// prior pages, regex-matches cast names). A DNA scene carries richer, explicit structure — present[] character
// ids, loc, the value turn — and its page is a throwaway projection. So this gathers context straight from the
// book_nodes tree and writes to node_scene_images (keyed by the scene node's STABLE id), reusing the same
// focal-staging craft (PROMPT_SYSTEM) + image helpers.
//
//   client → POST { bookId, nodeId, mode:"oneshot", pin? } → insert 'composing' row → (background) compose
//            the scene prompt from the node + present cast portraits → render → row 'ready'. When pin, the
//            chosen image is also written onto book_nodes.content.image_url (the render reads it; §4 of the spec).
//
// Synchronous insert, durable background render (EdgeRuntime.waitUntil). Allows MANY images per scene node.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
import { runInBackground, serviceClient } from "../_shared/task.ts";
import { generateImage, uploadDataUrl } from "../_shared/image.ts";
import { callClaude, textFromClaude, type CallMeta } from "../_shared/claude.ts";
import { IMAGE_PROMPT_MODEL } from "../_shared/model-config.ts";
import { PROMPT_SYSTEM } from "../_shared/sceneImagePrompts.ts";

interface Node {
  id: string; parent_id: string | null; kind: string; position?: number;
  content: Record<string, unknown>;
}
interface SceneContent {
  pov?: string; loc?: string; goal?: string; conflict?: string; outcome?: string;
  present?: string[]; value_shift?: { value?: string; from?: string; to?: string };
}
interface CharContent { name?: string; tag?: string; portraits?: string[] }

const NODE_SELECT = "id, node_id, book_id, image_url, prompt, status, error, scene_spec, created_at";

// Scenes in reading order: movements (by position) → their beats (by position) → their scenes (by position).
// Mirrors novelDna.scenesInOrder, minimally, so we can hand the renderer the PRIOR scenes for continuity.
function scenesInOrder(nodes: Node[]): Node[] {
  const childrenOf = (pid: string) => nodes.filter((n) => n.parent_id === pid).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const out: Node[] = [];
  for (const m of nodes.filter((n) => n.kind === "movement").sort((a, b) => (a.position ?? 0) - (b.position ?? 0)))
    for (const b of childrenOf(m.id)) if (b.kind === "beat")
      for (const s of childrenOf(b.id)) if (s.kind === "scene") out.push(s);
  return out;
}

// Synthesize the "beat to depict" from a scene node's plan — the single moment the image renders.
function describeScene(c: SceneContent): string {
  const parts = [
    c.goal ? `GOAL: ${c.goal}` : "",
    c.conflict ? `CONFLICT: ${c.conflict}` : "",
    c.outcome ? `OUTCOME: ${c.outcome}` : "",
    c.value_shift?.from && c.value_shift?.to ? `TURN: ${c.value_shift.value ? c.value_shift.value + " — " : ""}${c.value_shift.from} → ${c.value_shift.to}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { bookId, nodeId, mode = "oneshot", instruction, style, pin = false } =
      (await req.json().catch(() => ({}))) as {
        bookId?: number; nodeId?: string; mode?: "oneshot"; instruction?: string; style?: string; pin?: boolean;
      };
    if (!bookId || !nodeId) return json({ error: "bookId and nodeId are required" }, 400);
    if (!(await hasEditAccess(userClient, bookId, user.id))) return json({ error: "Access denied" }, 403);

    const { data: book } = await userClient.from("books").select("foundations").eq("id", bookId).single();
    const foundations = (book?.foundations as { art_direction?: string; image_model?: string } | null) ?? {};
    const houseLook = (style?.trim() || foundations.art_direction || "").trim();
    const imageModel = foundations.image_model;

    const { data: nodeRows } = await userClient.from("book_nodes").select("id, parent_id, kind, position, content").eq("book_id", bookId);
    const nodes = (nodeRows as Node[] | null) ?? [];
    const scene = nodes.find((n) => n.id === nodeId && n.kind === "scene");
    if (!scene) return json({ error: "Scene node not found" }, 404);
    const sc = scene.content as SceneContent;

    // Present cast = the character nodes this scene references in present[] (explicit ids). Scenes generated
    // by dna-expand don't populate present[], so FALL BACK to name-matching the cast against the scene plan
    // (goal/conflict/outcome/pov) — mirrors the page flow's namedIn, but resolving to character NODES.
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const cName = (n: Node) => String((n.content as CharContent).name ?? "").trim();
    const explicit = (sc.present ?? []).map((id) => byId.get(id)).filter((n): n is Node => !!n && n.kind === "character");
    let present = explicit;
    if (!present.length) {
      const planText = [sc.goal, sc.conflict, sc.outcome, byId.get(sc.pov ?? "") ? cName(byId.get(sc.pov!)!) : ""].filter(Boolean).join(" \n ");
      const namedIn = (name: string) => {
        const n = name.trim();
        return !!n && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(planText);
      };
      present = nodes.filter((n) => n.kind === "character" && namedIn(cName(n)));
    }
    // ONE portrait per present character (capped at 3 total) — more pushes the model toward a flat cast line-up.
    const refImages = present.flatMap((n) => ((n.content as CharContent).portraits ?? []).slice(0, 1)).slice(0, 3);

    // Prior scenes (reading order) for continuity — the up-to-2 preceding scenes' plans, never rendered.
    const order = scenesInOrder(nodes);
    const here = order.findIndex((s) => s.id === nodeId);
    const priorBeats = (here > 0 ? order.slice(0, here) : []).slice(-2).map((s) => describeScene(s.content as SceneContent)).filter(Boolean);

    const castNotes = present
      .map((n) => `- ${cName(n)}${(n.content as CharContent).tag?.trim() ? `: ${(n.content as CharContent).tag!.trim()}` : ""}`)
      .join("\n");
    const userContent = [
      priorBeats.length ? `RECENT BEATS (for continuity — do NOT depict):\n${priorBeats.map((b, i) => `${i + 1}.\n${b}`).join("\n\n")}` : null,
      `BEAT TO DEPICT:\n${[sc.loc ? `SETTING: ${sc.loc}` : "", describeScene(sc)].filter(Boolean).join("\n")}`,
      castNotes ? `CHARACTERS PRESENT (render faithfully):\n${castNotes}` : null,
      houseLook ? `HOUSE LOOK (the book's settled visual style — honour this so every scene looks like one book):\n${houseLook}` : null,
      instruction?.trim() ? `ART DIRECTION (author — honor this):\n${instruction.trim()}` : null,
      "Write the image prompt.",
    ].filter(Boolean).join("\n\n");

    const composeScenePromptText = async (): Promise<string> => {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      const meta: CallMeta = { fn: "generate-dna-scene-image", bookId, userId: user.id };
      const data = await callClaude(apiKey, {
        model: IMAGE_PROMPT_MODEL, max_tokens: 400, temperature: 0.8,
        system: [{ type: "text", text: PROMPT_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
      }, meta);
      return textFromClaude(data).trim();
    };

    // ── mode "oneshot": DURABLE compose + render in ONE background job (the picture-mode default) ──
    const svc = serviceClient();
    const { data: row, error: insErr } = await svc
      .from("node_scene_images")
      .insert({ node_id: nodeId, book_id: bookId, image_url: null, prompt: null, status: "composing", created_by: user.id })
      .select(NODE_SELECT)
      .single();
    if (insErr) throw insErr;

    runInBackground(svc, "node_scene_images", row.id, "generate-dna-scene-image", async () => {
      const promptText = await composeScenePromptText();
      if (!promptText) throw new Error("Could not compose a scene prompt.");
      const dataUrl = await generateImage({ prompt: promptText, refImages, model: imageModel });
      const url = await uploadDataUrl(svc, "scene-images", `scenes/node/${nodeId}/${Date.now()}.png`, dataUrl);
      // When pin: record the chosen illustration on the scene node (the render reads content.image_url, §4).
      // Read-modify-write of the single field — the studio is the only editor and the render window is short.
      if (pin) {
        const { data: cur } = await svc.from("book_nodes").select("content").eq("id", nodeId).single();
        const content = { ...((cur?.content as Record<string, unknown>) ?? {}), image_url: url };
        await svc.from("book_nodes").update({ content }).eq("id", nodeId);
      }
      return { prompt: promptText, image_url: url, status: "ready" };
    });

    return json(row);
  } catch (e) {
    console.error("generate-dna-scene-image error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
