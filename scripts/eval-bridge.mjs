#!/usr/bin/env node
// Local bridge between the web UI and Claude Code. The browser can't run a CLI,
// so this tiny server does it: on POST it runs `claude -p "/evaluate-book <id>"`
// (headless Claude Code) and returns the report it produces.
//
//   node scripts/eval-bridge.mjs            # listens on http://localhost:8787
//
//   GET  /eval/:bookId  -> existing report  { status: 'done'|'none', result? }
//   POST /eval/:bookId  -> run evaluation   { status: 'done'|'error', result?, error? }
//
// Env:
//   EVAL_BRIDGE_PORT   default 8787
//   EVAL_CLAUDE_FLAGS  default "--dangerously-skip-permissions"
//                      (headless run of our own trusted command; override to scope
//                       e.g. "--permission-mode acceptEdits --allowedTools Bash,Read,Write")
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportsDir = join(repoRoot, "reports");
const PORT = Number(process.env.EVAL_BRIDGE_PORT || 8787);
const CLAUDE_FLAGS = (process.env.EVAL_CLAUDE_FLAGS || "--dangerously-skip-permissions").split(" ").filter(Boolean);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (res, code, body) =>
  res.writeHead(code, { ...cors, "content-type": "application/json" }).end(JSON.stringify(body));

// Find an existing result for a book: prefer reports/<id>-read.json, else
// extract the ```json block from reports/<id>-*-read.md.
function loadReport(bookId) {
  const jsonPath = join(reportsDir, `${bookId}-read.json`);
  if (existsSync(jsonPath)) {
    try {
      return { result: JSON.parse(readFileSync(jsonPath, "utf8")) };
    } catch (e) {
      return { error: `bad ${bookId}-read.json: ${e.message}` };
    }
  }
  if (!existsSync(reportsDir)) return null;
  const md = readdirSync(reportsDir).find((f) => f.startsWith(`${bookId}-`) && f.endsWith("-read.md"));
  if (!md) return null;
  const m = readFileSync(join(reportsDir, md), "utf8").match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    return { result: JSON.parse(m[1]) };
  } catch (e) {
    return { error: `couldn't parse JSON block in ${md}: ${e.message}` };
  }
}

function runEvaluation(bookId) {
  return new Promise((resolve) => {
    const args = ["-p", `/evaluate-book ${bookId}`, ...CLAUDE_FLAGS];
    console.log(`→ claude ${args.join(" ")}`);
    const child = spawn("claude", args, { cwd: repoRoot });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.stdout.on("data", (d) => process.stdout.write(d)); // surface progress in the bridge terminal
    child.on("error", (e) => resolve({ error: `failed to spawn claude: ${e.message}` }));
    child.on("close", (code) => {
      if (code !== 0) return resolve({ error: `claude exited ${code}: ${stderr.slice(-500)}` });
      const report = loadReport(bookId);
      if (!report?.result) return resolve({ error: report?.error || "no report produced" });
      resolve({ result: report.result });
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  const m = req.url.match(/^\/eval\/(\d+)\/?$/);
  if (!m) return json(res, 404, { error: "use /eval/:bookId" });
  const bookId = Number(m[1]);

  if (req.method === "GET") {
    const report = loadReport(bookId);
    if (report?.result) return json(res, 200, { status: "done", result: report.result });
    return json(res, 200, { status: "none", ...(report?.error && { error: report.error }) });
  }
  if (req.method === "POST") {
    console.log(`Evaluating book ${bookId}…`);
    const out = await runEvaluation(bookId);
    if (out.error) return json(res, 500, { status: "error", error: out.error });
    return json(res, 200, { status: "done", result: out.result });
  }
  return json(res, 405, { error: "method not allowed" });
});

server.listen(PORT, () => {
  console.log(`eval-bridge listening on http://localhost:${PORT}  (repo: ${repoRoot})`);
  console.log(`  GET  /eval/:bookId   POST /eval/:bookId`);
});
