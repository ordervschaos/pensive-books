#!/usr/bin/env node
// One-off: write the FIRST scene's prose for a book with every model tier available to us, holding
// the production prompt constant, then lint + judge for general quality and contract fulfilment.
//
//   node scripts/model-prose-compare.mjs --book 1204 [--index 1]
//
// Claude-family gens run on `claude -p --model <m>` (the CC subscription, via the bridge's runClaude),
// per the user's instruction — no Anthropic API spend. Everything else routes through MuleRouter
// (OpenAI-compatible, /vendors/openai/v1), which serves the OpenRouter-tier models the app uses.
// The prompt is the EXACT one supabase/functions/dna-expand builds (captured via runDnaExpand).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Agent, setGlobalDispatcher } from "undici";
import { runProseLints, approxTokens, wordCount } from "./lib/prose-lints.mjs";

process.env.DNA_BRIDGE_NO_LISTEN = "1"; // import the bridge's run-functions without binding the port
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 60_000 }));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(repoRoot, ".env.local"), "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SUPABASE_URL = `https://${env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
const SR = env.SERVICE_ROLE_SECRET;
const MULE_KEY = env.MULE_ROUTER_API_KEY;
const MULE_URL = "https://api.mulerouter.ai/vendors/openai/v1/chat/completions";
const sb = { apikey: SR, Authorization: `Bearer ${SR}` };

const args = process.argv.slice(2);
const argVal = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const BOOK = Number(argVal("--book", 1204));
const INDEX = Number(argVal("--index", 1)); // 1-based reading-order scene index

// Models. Claude family → claude -p; the rest → MuleRouter. Labels mirror the app's tier names.
const CLAUDE_MODELS = [
  { id: "opus",   label: "opus (claude-opus-4-8)" },
  { id: "sonnet", label: "sonnet (claude-sonnet-4-6)" },
];
const MULE_MODELS = [
  { id: "qwen3.7-plus",    label: "qwen3.7-plus  ← PRODUCTION tier" },
  { id: "qwen3-max",       label: "qwen3-max" },
  { id: "deepseek-v4-pro", label: "deepseek-v4-pro" },
  { id: "kimi-k2.6",       label: "kimi-k2.6" },
  { id: "glm-5.1",         label: "glm-5.1" },
  { id: "gpt-5.5",         label: "gpt-5.5" },
  { id: "grok-4",          label: "grok-4" },
];

const ENTITY_KINDS = new Set(["character","relationship","tentpole","world_fact","location","thread","game","voice_profile"]);
function scenesInOrder(nodes) {
  const out = [];
  const kids = (pid) => nodes.filter((n) => n.parent_id === pid).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const walk = (n) => { if (n.kind === "scene") out.push(n); for (const c of kids(n.id)) if (!ENTITY_KINDS.has(c.kind)) walk(c); };
  for (const root of nodes.filter((n) => n.parent_id === null)) walk(root);
  return out;
}

// Spawn `claude -p --model <m>` directly (the bridge's runClaude isn't exported). Same flags it uses.
function claudeP(prompt, model) {
  return new Promise((resolve) => {
    const args = ["-p", prompt, "--dangerously-skip-permissions", "--model", model, "--tools", ""];
    const child = spawn("claude", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t0 = Date.now();
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 8 * 60 * 1000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 ? { text: out.trim(), ms: Date.now() - t0 } : { error: err.slice(0, 300) || `exit ${code}`, ms: Date.now() - t0 }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ error: String(e.message) }); });
  });
}

async function muleCall(model, prompt, attempt = 1) {
  const t0 = Date.now();
  // Per-model nonce: MuleRouter coalesces/caches CONCURRENT identical prompts and returns the same
  // bytes for different model ids (verified — deepseek/glm/grok came back byte-identical). A trailing
  // marker makes each request's prompt unique so each model actually runs. temperature>0 for variety.
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: `${prompt}\n\n<!-- gen-variant: ${model} -->` }],
    max_tokens: 4000,
    temperature: 0.8,
  });
  try {
    const res = await fetch(MULE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${MULE_KEY}`, "content-type": "application/json" },
      body,
    });
    const raw = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) return muleCall(model, prompt, attempt + 1);
      return { error: `HTTP ${res.status}: ${raw.slice(0, 300)}`, ms };
    }
    let j; try { j = JSON.parse(raw); } catch { return { error: `bad json: ${raw.slice(0,200)}`, ms }; }
    const text = (j.choices?.[0]?.message?.content ?? "").trim();
    return { text, ms, usage: j.usage };
  } catch (e) {
    if (attempt < 3) return muleCall(model, prompt, attempt + 1); // ECONNRESET etc. — retry
    return { error: `fetch failed: ${String(e?.message ?? e)}`, ms: Date.now() - t0 };
  }
}

async function main() {
  const outDir = join(repoRoot, "reports", `model-compare-${BOOK}-scene${INDEX}`);
  mkdirSync(outDir, { recursive: true });
  const capFile = join(outDir, "_capture.json");

  const nodes = await (await fetch(`${SUPABASE_URL}/rest/v1/book_nodes?book_id=eq.${BOOK}&select=id,parent_id,kind,position,content,authoring`, { headers: sb })).json();
  const scenes = scenesInOrder(nodes);
  const scene = scenes[INDEX - 1];
  if (!scene) throw new Error(`No scene at index ${INDEX} (have ${scenes.length})`);
  console.error(`[compare] book ${BOOK}, scene #${INDEX} = ${scene.id}`);
  console.error(`[compare] beat: ${JSON.stringify(scene.content).slice(0, 200)}`);

  // 1) Capture the EXACT production prompt (and opus's gen — runDnaExpand runs on claude -p opus).
  // Cached to _capture.json so a re-run reuses the slow opus call.
  let PROMPT, opusProse, sonnetProse;
  if (existsSync(capFile)) {
    const c = JSON.parse(readFileSync(capFile, "utf8"));
    PROMPT = c.prompt; opusProse = c.opusProse; sonnetProse = c.sonnetProse;
    console.error(`[compare] reusing cached prompt + opus + sonnet (${approxTokens(PROMPT)} tok)`);
  } else {
    const { runDnaExpand } = await import("./eval-bridge.mjs");
    console.error("[compare] capturing prompt + opus gen via claude -p …");
    const cap = await runDnaExpand({ bookId: BOOK, nodeId: scene.id, target: "prose", captureContext: true });
    if (cap.error) throw new Error(`runDnaExpand: ${cap.error}`);
    PROMPT = cap.prompt; opusProse = cap.prose;
    console.error(`[compare] prompt captured (${approxTokens(PROMPT)} tok). opus done. sonnet via claude -p …`);
    const son = await claudeP(PROMPT, "sonnet");
    sonnetProse = son.error ? "" : (son.text || "").trim();
    writeFileSync(capFile, JSON.stringify({ prompt: PROMPT, opusProse, sonnetProse }, null, 2));
  }

  const results = [];
  results.push({ model: "opus", label: CLAUDE_MODELS[0].label, via: "claude -p", text: opusProse, ms: null });
  results.push({ model: "sonnet", label: CLAUDE_MODELS[1].label, via: "claude -p", text: sonnetProse, ms: null });

  // 3) MuleRouter models — SEQUENTIALLY. Concurrent identical large prompts make MuleRouter fan one
  // cached completion out to multiple model ids (verified: byte-identical outputs across vendors, and
  // neither a per-model nonce nor temperature>0 defeated it — only running one-at-a-time does).
  console.error(`[compare] ${MULE_MODELS.length} MuleRouter models SEQUENTIALLY …`);
  for (const m of MULE_MODELS) {
    const r = await muleCall(m.id, PROMPT);
    console.error(`[compare]   ${m.id}: ${r.error ? "ERR " + r.error.slice(0,80) : (wordCount(r.text) + "w " + r.ms + "ms")}`);
    results.push({ model: m.id, label: m.label, via: "mulerouter", text: r.text || "", ms: r.ms, error: r.error });
  }

  // 4) Lints (objective)
  const castNames = nodes.filter((n) => n.kind === "character").map((n) => String(n.content?.name ?? "").trim()).filter(Boolean);
  const wordTarget = null; // no per-scene target; book band is novel
  for (const r of results) {
    r.lints = r.text ? runProseLints(r.text, { priorText: "", castNames, wordTarget }) : null;
    r.words = wordCount(r.text);
  }

  // 5) LLM judge (claude -p opus) — scores quality + contract fulfilment, blind to model identity
  console.error("[compare] judging via claude -p opus …");
  const labeled = results.filter((r) => r.text).map((r, i) => ({ tag: `M${i + 1}`, model: r.model, text: r.text }));
  const tagMap = Object.fromEntries(labeled.map((l) => [l.tag, l.model]));
  const judgePrompt = `You are a ruthless fiction editor. Below is THE CONTRACT for one scene (brief, mandate, voice profile, and the beat plan) followed by ${labeled.length} candidate prose drafts of that same scene, each from a different model (identities hidden as M1, M2 …).

Score each draft 1–10 on TWO axes:
  • QUALITY — prose craft: voice, sentence rhythm, concreteness, subtext, scene-craft, readability. Is it a good read?
  • CONTRACT — does it FULFIL the contract: hits the beat's causal turn and the two "keys"; honors the MANDATE (heat/tone — this is explicit romance, so heat must actually land, not fade-to-black); conforms to the VOICE PROFILE (POV/tense/style/rules); stays inside the story (no fourth-wall, no narrating craft intent)?

Be harsh and discriminating — spread the scores, don't cluster. Penalize: laundered/euphemistic heat when the mandate says explicit, generic "AI" prose, purple overwriting, missing the beat's turn, breaking POV/tense.

Return ONLY JSON: {"scores":[{"tag":"M1","quality":N,"contract":N,"one_line":"...","heat":"explicit|implied|none","biggest_flaw":"..."}],"ranking":["M?",...best-to-worst by combined],"verdict":"2-3 sentences: which model won and why, and which clearly failed the contract"}

===== THE CONTRACT =====
${PROMPT}

===== CANDIDATE DRAFTS =====
${labeled.map((l) => `\n----- ${l.tag} -----\n${l.text}`).join("\n")}`;

  const judgeOut = await claudeP(judgePrompt, "opus");
  let judge = null;
  if (!judgeOut.error) {
    const m = (judgeOut.text || "").match(/\{[\s\S]*\}/);
    try { judge = JSON.parse(m ? m[0] : judgeOut.text); } catch (e) { judge = { raw: judgeOut.text, parseError: String(e) }; }
  } else judge = { error: judgeOut.error };

  // 6) Write outputs
  for (const r of results) writeFileSync(join(outDir, `${r.model}.md`), `# ${r.label}\n\n${r.text || "(no output: " + (r.error || "empty") + ")"}\n`);
  writeFileSync(join(outDir, "_data.json"), JSON.stringify({ book: BOOK, scene: scene.id, beat: scene.content, prompt: PROMPT, tagMap, results: results.map(({ lints, ...r }) => ({ ...r, lints })), judge }, null, 2));

  // 7) Console summary table
  const score = (tag) => judge?.scores?.find((s) => s.tag === tag);
  console.error("\n================ RESULTS ================");
  for (const l of labeled) {
    const r = results.find((x) => x.model === l.model);
    const s = score(l.tag);
    console.error(`${l.tag} ${r.model.padEnd(16)} ${String(r.words).padStart(4)}w  Q=${s?.quality ?? "?"} C=${s?.contract ?? "?"} heat=${s?.heat ?? "?"}  ${s?.one_line ?? ""}`);
  }
  console.error("\nRANKING:", (judge?.ranking || []).map((t) => `${t}=${tagMap[t]}`).join(" > "));
  console.error("VERDICT:", judge?.verdict || JSON.stringify(judge)?.slice(0, 400));
  console.error(`\nFull outputs + data → ${outDir}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
