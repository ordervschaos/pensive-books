// Dev twin of api/stream-prose.ts: serves /api/stream-prose from the Vite dev server so the streaming proxy
// works same-origin on localhost:8080 with no separate process and no bridge. Prod uses the Vercel function;
// both call the same ./api/_proseProxy core. See TO-DO/dna-streaming-proxy.md.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { streamProse, ProxyError, type PrepareReq } from "./api/_proseProxy";

// The real secrets (OPENROUTER_API_KEY, SERVICE_ROLE_SECRET, VITE_SUPABASE_*) live in the repo-root
// .env.local, which Vite does NOT load into the dev server's process.env. Walk up from cwd and load EVERY
// .env.local found (nearest-first, no-clobber so a nearer override wins) — crucially we do NOT stop at the
// first one: the dev server's cwd is apps/web, whose own .env.local is empty, and the keys live one level up.
function loadRootEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, ".env.local");
    if (existsSync(p)) {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#") || !t.includes("=")) continue;
        const eq = t.indexOf("=");
        const k = t.slice(0, eq).trim();
        const v = t.slice(eq + 1).trim();
        if (!(k in process.env)) process.env[k] = v; // nearest-first wins; later (higher) files only fill gaps
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
}

export function streamProseDevPlugin(): Plugin {
  return {
    name: "stream-prose-dev",
    apply: "serve",
    configureServer(server) {
      loadRootEnv();
      server.middlewares.use("/api/stream-prose", async (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end("method not allowed"); return; }
        const authToken = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");

        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        let body: PrepareReq;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as PrepareReq; }
        catch { res.statusCode = 400; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: "invalid JSON body" })); return; }

        const gen = streamProse(body, authToken);
        let first: IteratorResult<string>;
        try { first = await gen.next(); }
        catch (e) {
          res.statusCode = e instanceof ProxyError ? e.status : 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          return;
        }
        res.statusCode = 200;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        try {
          if (!first.done && first.value) res.write(first.value);
          for await (const chunk of gen) res.write(chunk);
        } catch { /* mid-stream upstream break — end what we have */ }
        res.end();
      });
    },
  };
}
