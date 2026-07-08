// dna-decompose — Layer B of the epub import: the SEMANTIC ASCENT. Given an imported manuscript
// (prose is ground truth, plan rungs empty), infer the plan bottom-up. Three stateless steps, each
// one prompt→JSON call (read-synopsis shape — the client owns the tree and applies results as node
// ops through the fail-closed validateOps boundary):
//
//   step "chapter"  { chapter: { title, position, total, text }, prev? }
//                   → { beat: { summary, connector?, polarity? }, digest }
//   step "top"      { digests: [{ title, digest }] }
//                   → { seed: { logline }, premise: {...}, pillar: {...} }
//   step "entities" { digests: [{ title, digest }], sample }
//                   → { characters, relationships (by NAME — client resolves to ids), locations, voice }
//   step "systems"  { digests: [{ title, digest }] }
//                   → { world_facts, threads, games, tentpoles, meters } — story systems, each with
//                       1-based CHAPTER NUMBERS (setup/payoff/realized/resolved) the client turns into
//                       beat-level links (threads/realizes/resolves), so the obligation ledger and
//                       vertical lints work on an imported book
//
// Every inference is ABDUCTION (the plan that best explains the text) — the client writes it as
// source:"ai" so the author can freely correct it. Field keys come from the committed schema
// artifact (the same SSOT dna-chat/book-agent prompt from), so keys can't drift from dnaSchema.ts.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";
import dnaSchema from "../_shared/dna-schema.json" with { type: "json" };

interface DigestRow { title?: string; digest?: string }

const clamp = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
const oneOf = (v: unknown, opts: string[]): string | undefined =>
  typeof v === "string" && opts.includes(v) ? v : undefined;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown, max: number): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : []).slice(0, max).map(obj);

// Field-key guide for a set of kinds, straight from the schema artifact (SSOT).
const guideFor = (...kinds: string[]): string =>
  dnaSchema.promptGuide.split("\n").filter((l) => kinds.some((k) => l.startsWith(`- ${k} `))).join("\n");

const digestMenu = (digests: DigestRow[]): string =>
  digests.map((d, i) => `Chapter ${i + 1}${d.title ? ` "${d.title}"` : ""}:\n${d.digest ?? ""}`).join("\n\n");

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const bookId = body.bookId as number | undefined;
    const step = body.step as string | undefined;
    if (!bookId || !step) return json({ error: "bookId and step are required" }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Access check via RLS + book identity for prompt context.
    const { data: book } = await userClient.from("books").select("id, name, author").eq("id", bookId).maybeSingle();
    if (!book) return json({ error: "Book not found or access denied" }, 403);
    const bookLine = `"${book.name ?? "Untitled"}"${book.author ? ` by ${book.author}` : ""}`;

    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "dna-decompose", bookId, taskTable: "book_nodes", taskId: bookId };
    const ask = async (system: string, prompt: string, max_tokens: number, effort: "low" | "medium") => {
      const data = await callLLM(apiKey, {
        model, max_tokens, thinking: { type: "adaptive" }, output_config: { effort },
        system: [{ type: "text", text: system }],
        messages: [{ role: "user", content: prompt }],
      }, meta, { signal: AbortSignal.timeout(140_000) });
      return JSON.parse(extractJsonBlock(textFromLLM(data).trim())) as Record<string, unknown>;
    };

    // ── step: chapter — one chapter's prose → its beat row + a fold digest ────────────────────────
    if (step === "chapter") {
      const ch = obj(body.chapter);
      const text = clamp(ch.text, 60_000);
      if (!text) return json({ error: "chapter.text is required" }, 400);
      const prev = clamp(body.prev, 2_000);
      const parsed = await ask(
        "You are a story analyst decomposing an EXISTING manuscript into its structural plan. The prose is " +
          "ground truth — describe what IS on the page, never what a better version would do.",
        `Novel: ${bookLine}. Chapter ${ch.position ?? "?"} of ${ch.total ?? "?"}${ch.title ? ` — "${ch.title}"` : ""}.\n\n` +
          (prev ? `PREVIOUS CHAPTER (digest, for judging how this one connects):\n${prev}\n\n` : "") +
          `CHAPTER PROSE:\n${text}\n\n` +
          `Return ONLY this JSON (no fences):\n{\n` +
          `  "beat": {\n` +
          `    "summary": "<1-2 sentences: what happens as a story TURN (who acts, what changes)>",\n` +
          `    "connector": "<therefore|but — how this chapter follows from the previous one (causal = therefore, reversal = but). OMIT for chapter 1>",\n` +
          `    "polarity": "<up|down — does the protagonist's situation end better or worse than it began>"\n` +
          `  },\n` +
          `  "digest": "<3-5 sentences: events, reveals, relationship shifts, world rules established — enough to reconstruct the plot from digests alone>"\n}`,
        1_200, "low",
      );
      const beat = obj(parsed.beat);
      return json({
        beat: {
          summary: clamp(beat.summary, 600),
          connector: oneOf(beat.connector, ["therefore", "but"]),
          polarity: oneOf(beat.polarity, ["up", "down"]),
        },
        digest: clamp(parsed.digest, 1_500) ?? "",
      });
    }

    // ── step: top — all chapter digests → seed/premise/pillar content ─────────────────────────────
    if (step === "top") {
      const digests = arr(body.digests, 200) as DigestRow[];
      if (!digests.length) return json({ error: "digests are required" }, 400);
      const parsed = await ask(
        "You are a story analyst who has read a whole manuscript (as chapter digests). Distill its top-level " +
          "plan. Describe the book that EXISTS, not an improved one.\n\nCONTENT FIELD SCHEMAS:\n" +
          guideFor("seed", "premise", "pillar"),
        `Novel: ${bookLine}.\n\nCHAPTER DIGESTS (reading order):\n${digestMenu(digests)}\n\n` +
          `Return ONLY this JSON (no fences):\n{\n` +
          `  "seed": { "logline": "<one sentence: protagonist + inciting incident + goal + obstacle + stakes>" },\n` +
          `  "premise": { "dramatic_question": "<the central question the book lives inside>", "shape": { "name": "<the story shape, free text>", "movements": ["<3-6 movement labels>"], "ending_feel": "<up|down|bittersweet|ambivalent>" } },\n` +
          `  "pillar": { "controlling_idea": "<the thesis the ending argues>", "ending": "<what concretely happens at the end>" }\n}`,
        2_500, "medium",
      );
      const premise = obj(parsed.premise);
      const shape = obj(premise.shape);
      const pillar = obj(parsed.pillar);
      return json({
        seed: { logline: clamp(obj(parsed.seed).logline, 600) },
        premise: {
          dramatic_question: clamp(premise.dramatic_question, 600),
          shape: {
            name: clamp(shape.name, 120),
            movements: (Array.isArray(shape.movements) ? shape.movements : []).map((m) => clamp(m, 200)).filter(Boolean).slice(0, 8),
            ending_feel: oneOf(shape.ending_feel, ["up", "down", "bittersweet", "ambivalent"]),
          },
        },
        pillar: { controlling_idea: clamp(pillar.controlling_idea, 800), ending: clamp(pillar.ending, 800) },
      });
    }

    // ── step: entities — digests + a voice sample → cast, relationships, locations, voice ─────────
    if (step === "entities") {
      const digests = arr(body.digests, 200) as DigestRow[];
      if (!digests.length) return json({ error: "digests are required" }, 400);
      const sample = clamp(body.sample, 4_000);
      const parsed = await ask(
        "You are a story analyst extracting the entity registry from a manuscript (chapter digests + an " +
          "opening prose sample). Extract only what the TEXT establishes — no invention. Relationships " +
          "reference characters by exact NAME from your own characters list.\n\nCONTENT FIELD SCHEMAS:\n" +
          guideFor("character", "relationship", "location", "voice_profile"),
        `Novel: ${bookLine}.\n\nCHAPTER DIGESTS (reading order):\n${digestMenu(digests)}\n\n` +
          (sample ? `OPENING PROSE SAMPLE (for voice):\n${sample}\n\n` : "") +
          `Return ONLY this JSON (no fences):\n{\n` +
          `  "characters": [{ "name", "role", "want", "need", "wound", "tag" }],  // named cast that matters, max 12\n` +
          `  "relationships": [{ "a": "<character name>", "b": "<character name>", "bond", "charge" }],  // max 10\n` +
          `  "locations": [{ "name", "summary", "mood", "sight", "sound", "smell" }],  // recurring places only, max 8; sensory fields only where the text gives them\n` +
          `  "voice": { "pov", "tense", "style", "constraints": [] }  // the prose voice observed in the sample\n}`,
        6_000, "medium",
      );
      const voice = obj(parsed.voice);
      return json({
        characters: arr(parsed.characters, 12).map((c) => ({
          name: clamp(c.name, 80), role: clamp(c.role, 30), want: clamp(c.want, 400),
          need: clamp(c.need, 400), wound: clamp(c.wound, 400), tag: clamp(c.tag, 200),
        })).filter((c) => c.name),
        relationships: arr(parsed.relationships, 10).map((r) => ({
          a: clamp(r.a, 80), b: clamp(r.b, 80), bond: clamp(r.bond, 300), charge: clamp(r.charge, 300),
        })).filter((r) => r.a && r.b && r.bond),
        locations: arr(parsed.locations, 8).map((l) => ({
          name: clamp(l.name, 80), summary: clamp(l.summary, 400), mood: clamp(l.mood, 200),
          sight: clamp(l.sight, 200), sound: clamp(l.sound, 200), smell: clamp(l.smell, 200),
        })).filter((l) => l.name),
        voice: {
          pov: oneOf(voice.pov, ["first-person", "third-person-limited", "third-person-omniscient", "second-person"]),
          tense: oneOf(voice.tense, ["past", "present"]),
          style: clamp(voice.style, 600),
          constraints: (Array.isArray(voice.constraints) ? voice.constraints : []).map((c) => clamp(c, 200)).filter(Boolean).slice(0, 8),
        },
      });
    }

    // ── step: systems — digests → world rules, threads, games, tentpoles, meters + chapter links ──
    if (step === "systems") {
      const digests = arr(body.digests, 200) as DigestRow[];
      if (!digests.length) return json({ error: "digests are required" }, 400);
      const parsed = await ask(
        "You are a story analyst extracting the STORY SYSTEMS from a manuscript (chapter digests). Extract " +
          "only what the TEXT establishes — no invention. Reference chapters by their NUMBER as listed. " +
          "Games reference players by character NAME and governing rules by world-fact NAME from your own " +
          "lists. Do NOT create a thread for a game's outcome (games auto-carry a resolution thread) and do " +
          "NOT create game_score meters (auto-derived).\n\nCONTENT FIELD SCHEMAS:\n" +
          guideFor("world_fact", "thread", "game", "tentpole", "meter"),
        `Novel: ${bookLine}.\n\nCHAPTER DIGESTS (reading order):\n${digestMenu(digests)}\n\n` +
          `Return ONLY this JSON (no fences):\n{\n` +
          `  "world_facts": [{ "name", "rule", "mechanism", "category" }],  // rules the story world runs on, max 14; [] for mundane settings\n` +
          `  "threads": [{ "name", "kind", "promise", "payoff", "setup_chapter": <n>, "payoff_chapter": <n or omit if unpaid> }],  // promises to the reader (mystery|foreshadow|setup_payoff|arc), max 10\n` +
          `  "games": [{ "name", "players": ["<character name>"], "win_condition", "lose_condition", "stake", "governing_rules": ["<world fact name>"], "outcome": "<won|lost, omit if undecided>", "resolved_chapter": <n> }],  // explicit contests with win/lose conditions, max 6; [] if none\n` +
          `  "tentpoles": [{ "summary", "realized_chapter": <n> }],  // the big set-piece moments the book builds to, max 8\n` +
          `  "meters": [{ "name", "kind", "poles": { "low", "high" }, "scale": { "min": 0, "max": 10 } }]  // 1-4 numeric axes this book visibly runs on (tension|heat|comedy|affect|relationship|value|custom)\n}`,
        8_000, "medium",
      );
      return json({
        world_facts: arr(parsed.world_facts, 14).map((w) => ({
          name: clamp(w.name, 80), rule: clamp(w.rule, 400), mechanism: clamp(w.mechanism, 400), category: clamp(w.category, 60),
        })).filter((w) => w.name && w.rule),
        threads: arr(parsed.threads, 10).map((t) => ({
          name: clamp(t.name, 80), kind: oneOf(t.kind, ["mystery", "foreshadow", "setup_payoff", "arc"]),
          promise: clamp(t.promise, 400), payoff: clamp(t.payoff, 400),
          setup_chapter: num(t.setup_chapter), payoff_chapter: num(t.payoff_chapter),
        })).filter((t) => t.name && t.promise),
        games: arr(parsed.games, 6).map((g) => ({
          name: clamp(g.name, 80),
          players: (Array.isArray(g.players) ? g.players : []).map((p) => clamp(p, 80)).filter(Boolean).slice(0, 6),
          win_condition: clamp(g.win_condition, 300), lose_condition: clamp(g.lose_condition, 300), stake: clamp(g.stake, 300),
          governing_rules: (Array.isArray(g.governing_rules) ? g.governing_rules : []).map((r) => clamp(r, 80)).filter(Boolean).slice(0, 6),
          outcome: oneOf(g.outcome, ["won", "lost"]), resolved_chapter: num(g.resolved_chapter),
        })).filter((g) => g.name && g.win_condition && g.lose_condition),
        tentpoles: arr(parsed.tentpoles, 8).map((t) => ({
          summary: clamp(t.summary, 300), realized_chapter: num(t.realized_chapter),
        })).filter((t) => t.summary),
        meters: arr(parsed.meters, 4).map((m) => {
          const poles = obj(m.poles), scale = obj(m.scale);
          return {
            name: clamp(m.name, 60),
            kind: oneOf(m.kind, ["value", "affect", "relationship", "heat", "comedy", "tension", "custom"]),
            poles: { low: clamp(poles.low, 200), high: clamp(poles.high, 200) },
            scale: { min: num(scale.min) ?? 0, max: num(scale.max) ?? 10 },
          };
        }).filter((m) => m.name),
      });
    }

    return json({ error: `unknown step "${step}"` }, 400);
  } catch (e) {
    console.error("dna-decompose error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
