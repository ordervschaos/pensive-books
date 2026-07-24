#!/usr/bin/env node
// claude-local-shim — a laptop-side sidecar that lets the book-agent's model calls run on
// subscription-billed `claude -p` (headless Claude Code) instead of a per-token API host.
//
// It is the ONLY new file for the `claude-local` bridge (doc_1783662297825.md): it adapts one
// HTTP request/response pair, nothing else. The edge fn, its prompts, and its tool-loop state are
// untouched — `_shared/llm.ts` forwards the unchanged Anthropic Messages-shaped request here
// whenever `model === "claude-local"`, and expects back the same shape it would get from
// api.anthropic.com.
//
//   node scripts/claude-local-shim.mjs        # listens on http://localhost:8788
//
//   POST /v1/messages   Anthropic Messages request in -> Anthropic Messages response out
//   GET  /health         liveness probe
//
// Activate by setting CLAUDE_LOCAL_URL in supabase/functions/.env to this shim's address AS SEEN
// FROM THE EDGE RUNTIME CONTAINER — that's `http://host.docker.internal:<port>/v1/messages`, not
// `localhost` (`supabase functions serve` runs the edge runtime in Docker). Then set the agent
// role's tier to claude-local from /admin/settings (ai_model_tier_agent). Deployed functions can't
// reach a laptop at all, so this is dev-only by construction — see the doc for the full tradeoff.
//
// Env:
//   CLAUDE_LOCAL_SHIM_PORT        default 8788
//   CLAUDE_LOCAL_SHIM_MODEL       optional --model override passed to `claude -p` (default: the CLI's own default)
//   CLAUDE_LOCAL_SHIM_TIMEOUT_MS  default 20min — claude -p on subscription is congestion-bound (2-21min observed)
//   CLAUDE_LOCAL_SHIM_FLAGS       default "--bare --dangerously-skip-permissions" (space-separated, like eval-bridge)
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.CLAUDE_LOCAL_SHIM_PORT || 8788);
const MODEL = process.env.CLAUDE_LOCAL_SHIM_MODEL || null;
const TIMEOUT_MS = Number(process.env.CLAUDE_LOCAL_SHIM_TIMEOUT_MS ?? 20 * 60 * 1000);
const CLAUDE_FLAGS = (process.env.CLAUDE_LOCAL_SHIM_FLAGS || "--dangerously-skip-permissions").split(" ").filter(Boolean);

// Spawn from a FRESH, EMPTY directory PER CALL (not a shared one reused across turns, and not this
// repo) — `--tools ""` means the child never needs filesystem access, so there's no reason to run it
// inside a real project, and every reason not to: a non-empty/reused cwd gives Claude Code something
// to walk up from and pick up as ambient project context (nearby .git, package.json, stray files from a
// prior call) it has no business seeing for a one-shot completion. mkdtempSync/rmSync per call in
// runClaudeLocal() below; nothing here at module load time.
//
// The fresh cwd does NOT stop USER/GLOBAL-scoped context — `~/.claude/CLAUDE.md`, the auto-memory,
// and the SessionStart hooks that enabled plugins (vercel, chrome-devtools, ...) register are loaded
// regardless of cwd. Verified live 2026-07-10 (second incident): a book-agent "suggest logline" call
// came back as Claude Code narrating MY OWN coding session — "the uncommitted changes... aren't mine
// to catalogue; doing a /wrap on someone else's in-flight work would misattribute it" — the user's
// global CLAUDE.md (a PM /wrap ritual + auto-memory) had contaminated book-agent's persona.
//
// A PRIOR fix claimed `--system-prompt` alone suppressed this. It does NOT — re-verified empirically on
// CLI 2.1.207 (2026-07-12): with `--system-prompt` set, the global `~/.claude/CLAUDE.md` AND the Vercel
// plugin's SessionStart blob still leaked in full. `--system-prompt` only sets the persona; it does not
// disable ambient CLAUDE.md/plugins/hooks. `--bare` disables them but forces ANTHROPIC_API_KEY-only auth
// (no OAuth/keychain) — defeating this bridge's whole point (subscription billing, not per-token spend).
//
// Actual fix: `--safe-mode` — starts with ALL customizations disabled (CLAUDE.md, skills, plugins, hooks,
// MCP servers, custom agents, ...) WITHOUT `--bare`'s api-key restriction. Verified from cwd=repo (the
// worst case) with ANTHROPIC_API_KEY unset: the leak probe returned exactly "NONE" and auth still held
// (subscription, not per-token). So `--safe-mode` kills the leak, `--system-prompt` delivers the persona,
// and only the conversation transcript goes through `-p` — see buildSystemPrompt/buildUserPrompt below.
// The per-call temp cwd stays as defense-in-depth (it independently blocks PROJECT-scoped hooks/CLAUDE.md).

// `system` may be a plain string or an array of { type:'text', text } blocks (with cache_control) —
// mirrors systemText() in _shared/llm.ts. Duplicated because this process can't import Deno TS.
function systemText(system) {
  if (system == null) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) return system.map((b) => (typeof b === "string" ? b : b?.text ?? "")).join("\n");
  return JSON.stringify(system);
}

function textOf(blocks) {
  return blocks.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n").trim();
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return textOf(content);
  return String(content ?? "");
}

// Prior tool_use/tool_result turns render as plain lines — there is no session state on the CLI
// side (each call is a fresh `claude -p`), so the whole transcript is re-flattened into the prompt
// every turn, same as the doc's design.
function flattenMessage(msg) {
  if (!Array.isArray(msg.content)) return msg.content ? `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}` : null;
  const lines = [];
  if (msg.role === "assistant") {
    for (const b of msg.content) {
      if (b?.type === "text" && b.text) lines.push(`Assistant: ${b.text}`);
      if (b?.type === "tool_use") lines.push(`Assistant called ${b.name}(${JSON.stringify(b.input ?? {})})`);
    }
  } else {
    for (const b of msg.content) {
      if (b?.type === "tool_result") lines.push(`Tool result (${b.tool_use_id}): ${resultText(b.content)}`);
    }
    const text = textOf(msg.content);
    if (text) lines.push(`User: ${text}`);
  }
  return lines.join("\n") || null;
}

// Tools via a prompted JSON envelope, not native tool-use — `claude -p` doesn't speak the Messages
// tool protocol (it IS an agent, not a completions endpoint). This repo already trusts this pattern
// (the beats-agent's JSON envelope). Weaker than native tool_use (no parallel calls, occasional
// malformed replies) but the agent executor already tolerates malformed tool output.
function toolEnvelopeBlock(tools) {
  if (!Array.isArray(tools) || !tools.length) return "";
  const schemas = tools
    .map((t) => `- ${t.name}: ${t.description ?? ""}\n  input_schema: ${JSON.stringify(t.input_schema ?? { type: "object" })}`)
    .join("\n");
  return [
    "You have access to these tools:",
    schemas,
    "",
    "Reply with EXACTLY ONE JSON object and nothing else — no markdown fences, no commentary, no narration, no acknowledgment of what you're about to do:",
    '  {"tool": "<tool name>", "input": {...}}   to call a tool, or',
    '  {"text": "<your answer>"}                  to answer directly without calling a tool, or',
    '  {"tool": "<tool name>", "input": {...}, "text": "<your reply>"}   to reply to the author AND call a tool in the same turn (use this whenever a tool call should be accompanied by your conversational reply, e.g. update_vision alongside your next interview questions).',
    "",
    'WRONG: Assistant: I\'ll check the sketch first.\nsearch_nodes({"query": "apple"})',
    'RIGHT: {"tool": "search_nodes", "input": {"query": "apple"}}',
    'The conversation history below renders past turns as "Assistant: ..." / "User: ..." lines for',
    "readability — that is a LOG FORMAT, not a reply template. Do not imitate it.",
  ].join("\n");
}

// Everything that defines WHO the model is this turn (book-agent's persona + the tool envelope
// instructions) — goes through --system-prompt, which replaces Claude Code's own default system prompt
// rather than appending to it (that's what keeps the global CLAUDE.md/memory/git-status content out).
function buildSystemPrompt(body) {
  const sys = systemText(body.system);
  const toolBlock = toolEnvelopeBlock(body.tools);
  return [sys, toolBlock].filter(Boolean).join("\n\n");
}

// Everything that defines WHAT to respond to this turn — the flattened conversation. Goes through -p.
// No leading "---"-style delimiter: a userPrompt starting with dashes gets misparsed as a CLI flag by
// `claude`'s own arg parser (spawn() passes it as one literal argv entry, but the parser still balks at
// a value that LOOKS like an option) — verified live: "unknown option '--- conversation so far ---...'".
function buildUserPrompt(body) {
  const transcript = (body.messages ?? []).map(flattenMessage).filter(Boolean).join("\n\n");
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  return [
    "Conversation so far:",
    transcript,
    // Only tool calls get the {tool}/{text} envelope protocol (see toolEnvelopeBlock). A plain generation
    // call (sketch/prose/structure — no tools) must NOT be told to follow a JSON reply format: its own
    // prompt already says what to emit (JSON for a sketch, raw prose for a page), and pointing it at a
    // nonexistent envelope risks wrapping prose in JSON.
    hasTools
      ? "Respond now, as the assistant, following the JSON reply format in the system prompt."
      : "Respond now, as the assistant.",
  ].filter(Boolean).join("\n\n");
}

// Find the first balanced top-level {...} object in text, respecting string literals — so a stray
// "}" inside a quoted string value (or in narration trailing the envelope) can't truncate or
// extend the match. Replaces a prior indexOf("{")/lastIndexOf("}") that grabbed the LAST "}" in
// the whole text: any post-envelope narration containing its own brace broke the parse and the
// raw JSON leaked into the chat as if it were the model's reply (2026-07-13, observed live on a
// propose_prose_render call with a large multi-field input).
function extractBalancedObject(text) {
  const openAt = text.indexOf("{");
  if (openAt === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = openAt; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(openAt, i + 1);
    }
  }
  return null; // unterminated — truncated output
}

// Malformed/absent JSON envelope -> null; toAnthropicResponse below throws in that case, which
// the caller (book-agent's tool loop) surfaces as a normal callLLM error and retries.
function extractEnvelope(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const jsonText = extractBalancedObject(candidate);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function toAnthropicResponse(raw, requestedModel, hasTools) {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // Plain generation (no tools requested): the completion IS the reply — a scene sketch's domain JSON, a
  // page's prose, any structured text the caller's OWN prompt asked for. toolEnvelopeBlock only injects the
  // {tool}/{text} protocol when tools are present, so there is no envelope to parse here; pass the raw
  // completion through verbatim as a text block. (Demanding an envelope for these calls is exactly what
  // broke sketch/prose once model-config routed the structure+prose roles to this shim in local dev.)
  if (!hasTools) {
    return {
      id: `msg_local_${stamp}`,
      type: "message",
      role: "assistant",
      model: requestedModel,
      content: [{ type: "text", text: raw.trim() }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: null, output_tokens: null },
    };
  }
  const envelope = extractEnvelope(raw);
  if (envelope && typeof envelope.tool === "string") {
    // Speak-and-act: an optional `text` alongside `tool` becomes a text block BEFORE the tool_use —
    // the reply and the call in one completion (book-agent's result-blind rule then ends the turn
    // without a second model call; see advance.ts).
    const speech = typeof envelope.text === "string" && envelope.text.trim()
      ? [{ type: "text", text: envelope.text.trim() }]
      : [];
    return {
      id: `msg_local_${stamp}`,
      type: "message",
      role: "assistant",
      model: requestedModel,
      content: [...speech, { type: "tool_use", id: `toolu_local_${stamp}`, name: envelope.tool, input: envelope.input ?? {} }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: null, output_tokens: null },
    };
  }
  if (envelope && typeof envelope.text === "string") {
    return {
      id: `msg_local_${stamp}`,
      type: "message",
      role: "assistant",
      model: requestedModel,
      content: [{ type: "text", text: envelope.text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: null, output_tokens: null },
    };
  }
  // Neither shape matched — the model narrated instead of emitting the envelope (observed: it mimics
  // the flattened "Assistant: ..." transcript lines it's shown as history). Fail loud rather than
  // dumping that narration into the UI as if it were a legitimate reply — the /v1/messages handler's
  // catch turns this into a normal callLLM error, which the tool loop already knows how to surface.
  throw new Error(`claude-local: model did not return a valid {tool}/{text} envelope — raw: ${raw.slice(0, 300)}`);
}

// Spawn recipe lifted from eval-bridge's runClaude (scripts/eval-bridge.mjs:583): stdin ignored so
// `claude -p` gets immediate EOF instead of waiting on an empty pipe, prompt via the -p arg, SIGTERM
// then SIGKILL escalation on timeout. Two load-bearing flags: `--tools ""` forces a single completion
// instead of a multi-minute repo-roaming agentic run; `--safe-mode` disables all ambient customizations
// (global CLAUDE.md, plugins, hooks, memory) so none of it seeps into the book-gen context (see header).
function runClaudeLocal(systemPrompt, userPrompt) {
  // Fresh, empty cwd for THIS call only — mkdtemp guarantees a unique, just-created directory (no
  // leftovers from a prior turn), and it's removed once this call settles either way. Never inside the
  // repo, so `claude` walking up from cwd finds no .git/package.json/CLAUDE.md to treat as ambient
  // project context — it should see only --system-prompt and -p, nothing it "discovered".
  const spawnCwd = mkdtempSync(join(tmpdir(), "claude-local-shim-"));
  const cleanup = () => {
    try {
      rmSync(spawnCwd, { recursive: true, force: true });
    } catch (e) {
      console.warn(`✗ failed to remove ${spawnCwd}:`, e.message);
    }
  };
  return new Promise((resolve, reject) => {
    const args = [
      "-p", userPrompt,
      "--system-prompt", systemPrompt,
      "--safe-mode", // load-bearing: no ambient CLAUDE.md/plugins/hooks/memory bleed — see header
      ...CLAUDE_FLAGS,
      ...(MODEL ? ["--model", MODEL] : []),
      "--tools", "",
    ];
    const child = spawn("claude", args, { cwd: spawnCwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = TIMEOUT_MS > 0
      ? setTimeout(() => {
          settled = true;
          console.warn(`✗ claude -p exceeded ${TIMEOUT_MS / 1000}s — killing`);
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 2000).unref?.();
          cleanup();
          reject(new Error(`claude -p exceeded ${TIMEOUT_MS / 1000}s`));
        }, TIMEOUT_MS)
      : null;
    timer?.unref?.();

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error(`failed to spawn claude: ${e.message}`));
    });
    child.on("close", (code) => {
      if (settled) return; // already timed out or errored
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.slice(-500)}`));
      resolve(stdout.trim());
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method !== "POST" || req.url !== "/v1/messages") {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "not found" }));
  }

  const started = Date.now();
  try {
    const body = JSON.parse(await readBody(req));
    const systemPrompt = buildSystemPrompt(body);
    const userPrompt = buildUserPrompt(body);
    console.log(
      `→ claude -p [model=${body.model ?? "?"} messages=${body.messages?.length ?? 0} tools=${body.tools?.length ?? 0}] "${userPrompt.slice(0, 80).replace(/\n/g, " ")}…"`,
    );
    const raw = await runClaudeLocal(systemPrompt, userPrompt);
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const data = toAnthropicResponse(raw, body.model, hasTools);
    const latencyS = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`← ${data.stop_reason} in ${latencyS}s`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`claude-local-shim listening on http://localhost:${PORT}`);
  console.log(`edge runtime reaches it at http://host.docker.internal:${PORT}/v1/messages (set CLAUDE_LOCAL_URL to that)`);
});
