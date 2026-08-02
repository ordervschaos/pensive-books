import { createDigest } from "../actions";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export const dynamic = "force-dynamic";

const FIELD = "w-full rounded border border-rule bg-white px-3 py-2 text-sm";

export default function NewDigestPage() {
  return (
    <main className="max-w-xl space-y-6">
      <Breadcrumbs items={[{ label: "Digests", href: "/" }, { label: "New" }]} />
      <div>
        <h1 className="text-2xl">New digest</h1>
        <p className="text-sm text-muted">You&apos;ll add sources on the next screen.</p>
      </div>

      <form action={createDigest} className="space-y-4">
        <label className="block space-y-1">
          <span className="font-mono text-xs uppercase tracking-wider text-muted">Name</span>
          <input name="name" defaultValue="Morning Digest" className={FIELD} />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Deliver at</span>
            <input name="deliver_at" type="time" defaultValue="06:00" className={FIELD} />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Timezone</span>
            {/* Wall-clock time in this zone — so 6am stays 6am across DST. */}
            <input name="timezone" defaultValue="Asia/Kolkata" placeholder="Asia/Kolkata" className={FIELD} />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="font-mono text-xs uppercase tracking-wider text-muted">Voice</span>
          <textarea
            name="voice"
            rows={4}
            className={FIELD}
            placeholder="Who you are and what to skip. e.g. &quot;I build an AI writing tool. Skip funding rounds and personnel news. Assume I know the basics. Be blunt.&quot;"
          />
          <span className="block text-xs text-muted">
            Standing instructions applied to every section. The house rules — source everything, never pad —
            are always on and aren&apos;t editable.
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="ai_enabled" className="mt-1" />
          <span>
            AI writing (paid)
            <span className="block text-xs text-muted">
              Leave this off unless you want it. Off, sections are a plain linked list of what was gathered
              — no writing, no editorial triage. On, sections are selected and written for you.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="web_search_enabled" className="mt-1" />
          <span>
            Allow live web search
            <span className="block text-xs text-muted">
              Requires AI writing above. RSS feeds cost nothing to gather; live search runs a paid model
              every morning whether or not it finds anything.
            </span>
          </span>
        </label>

        <button type="submit" className="rounded bg-ink px-4 py-2 font-mono text-sm text-paper">
          Create
        </button>
      </form>
    </main>
  );
}
