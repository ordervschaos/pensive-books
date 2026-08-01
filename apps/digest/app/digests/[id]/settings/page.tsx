import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Digest } from "@/lib/digest/types";
import { updateDigest } from "../../actions";

export const dynamic = "force-dynamic";

const FIELD = "w-full rounded border border-rule bg-white px-3 py-2 text-sm";
const LABEL = "font-mono text-xs uppercase tracking-wider text-muted";

export default async function SettingsPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data } = await supabase
    .from("digests")
    .select("id, name, timezone, deliver_at, active, voice, web_search_enabled")
    .eq("id", Number(params.id))
    .maybeSingle();
  if (!data) notFound();

  const digest = data as Pick<
    Digest,
    "id" | "name" | "timezone" | "deliver_at" | "active" | "voice" | "web_search_enabled"
  >;

  return (
    <form action={updateDigest} className="space-y-4 rounded border border-rule bg-white/50 p-4">
      <input type="hidden" name="id" value={digest.id} />
      <label className="block space-y-1">
        <span className={LABEL}>Name</span>
        <input name="name" defaultValue={digest.name} className={FIELD} />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1">
          <span className={LABEL}>Deliver at</span>
          <input name="deliver_at" type="time" defaultValue={digest.deliver_at.slice(0, 5)} className={FIELD} />
        </label>
        <label className="block space-y-1">
          <span className={LABEL}>Timezone</span>
          <input name="timezone" defaultValue={digest.timezone} className={FIELD} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className={LABEL}>Voice</span>
        <textarea name="voice" rows={4} defaultValue={digest.voice ?? ""} className={FIELD} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={digest.active} />
        Active
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="web_search_enabled"
          defaultChecked={digest.web_search_enabled}
          className="mt-1"
        />
        <span>
          Allow live web search
          <span className="block text-xs text-muted">
            Only <code>search</code> sections use it, and it&apos;s the one source that bills every
            morning. Feeds, books and reflections cost nothing to gather. Off by default.
          </span>
        </span>
      </label>
      <button type="submit" className="rounded bg-ink px-4 py-2 font-mono text-sm text-paper">
        Save
      </button>

      {/* Two settings pages exist and the split is real — this one is per-digest, the other is per-account.
          Without this pointer the reader looks for Readwise here, finds nothing, and concludes it wasn't
          built. The signpost costs two lines; the confusion costs a support round-trip. */}
      <p className="border-t border-rule pt-3 text-sm text-muted">
        Connections that belong to <em>you</em> rather than to this digest — Readwise, for one — live on{" "}
        <a href="/settings" className="underline">
          account settings
        </a>
        . One token there serves every digest you own.
      </p>
    </form>
  );
}
