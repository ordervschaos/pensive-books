/**
 * Smoke test for the DATABASE-backed source adapters, against the real project.
 *
 *   cd apps/digest && npx tsx --env-file=.env.local scripts/smoke-db-sources.ts <digestId>
 *
 * `unread` and `inbox` retrieve nothing from the network — they read the corpus and the mailbox this digest
 * already owns. That makes them the two adapters a preview can't tell you much about (a preview shows what
 * a section produced, not whether the pool it drew from was empty for the reason you think). This prints
 * the pool.
 *
 * Service role, read-only. It writes nothing and sends nothing.
 */
import { unreadAdapter } from "../lib/digest/sources/unread";
import { inboxAdapter } from "../lib/digest/sources/inbox";
import { createServiceClient } from "../lib/supabase/server";
import type { Digest, Item, RunCtx, Section } from "../lib/digest/types";

const digestId = Number(process.argv[2]);
if (!digestId) {
  console.error("usage: npx tsx --env-file=.env.local scripts/smoke-db-sources.ts <digestId>");
  process.exit(1);
}

function show(label: string, items: Item[]) {
  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 44 - label.length))}`);
  if (!items.length) {
    console.log("  (empty pool)");
    return;
  }
  for (const i of items) {
    console.log(`  · ${i.title.slice(0, 70)}`);
    console.log(`      ${i.source ?? "?"} · ${i.published_at ?? "?"} · ${i.text.length} chars`);
  }
}

async function main() {
  const db = createServiceClient();
  const { data } = await db
    .from("digests")
    .select("id, owner_id, name, timezone, deliver_at, active, voice, web_search_enabled, sections, delivery, inbox_token")
    .eq("id", digestId)
    .maybeSingle();
  if (!data) throw new Error(`digest ${digestId} not found`);

  const digest = data as Digest;
  console.log(`digest ${digest.id} · ${digest.name} · inbox token ${digest.inbox_token ?? "(none)"}`);

  const ctx: RunCtx = {
    digest,
    issueDate: new Date().toISOString().slice(0, 10),
    seen: () => false,
    cachedBody: () => undefined,
  };

  const unread: Section = { id: "probe", kind: "unread", title: "Unread", max_items: 5 };
  const inbox: Section = { id: "probe", kind: "inbox", title: "Inbox", max_items: 5, days: 14 };

  show("unread (corpus leftovers)", await unreadAdapter(unread, ctx));
  show("inbox (mail, last 14 days)", await inboxAdapter(inbox, ctx));

  // The corpus totals put the unread pool in context: "0 items" means something different when the corpus
  // holds 4 posts than when it holds 400.
  const { count: total } = await db
    .from("digest_posts")
    .select("id", { count: "exact", head: true })
    .eq("digest_id", digest.id);
  const { count: used } = await db
    .from("digest_posts")
    .select("id", { count: "exact", head: true })
    .eq("digest_id", digest.id)
    .not("used_at", "is", null);
  console.log(`\ncorpus: ${used ?? 0} delivered of ${total ?? 0} pulled`);
}

void main();
