"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Three actions, in increasing order of commitment:
//
//   Preview    compile and look at it — no mail, no rows, no seen-items
//   Run now    the real pipeline; a no-op if today was already delivered
//   Regenerate rebuild a day that was already delivered, and send it again
//
// Regenerate is separated from Run now rather than folded into it because the no-op on an already-sent day
// is a safety property, not an inconvenience — it's what stops a watchdog retry or a double tick from
// mailing the same morning twice. Overriding it should be a deliberate second click.
export function RunNowButton({ digestId }: { digestId: number }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | string>("idle");

  async function run(force: boolean) {
    if (force && !confirm("Rebuild today's issue and send it to your Kindle again?")) return;
    setState("running");
    try {
      const res = await fetch(`/api/digests/${digestId}/run${force ? "?force=1" : ""}`, { method: "POST" });
      const body = await res.json();
      setState(
        body.error
          ? `${body.status ?? "failed"}: ${body.error}`
          : body.status === "already_sent"
            ? "already sent today — use Regenerate"
            : (body.status ?? "done"),
      );
      router.refresh();
    } catch (e) {
      setState(String((e as Error)?.message ?? e));
    }
  }

  const busy = state === "running";

  return (
    <div className="flex items-center gap-3">
      {state !== "idle" && <span className="font-mono text-xs text-muted">{state}</span>}
      {/* Preview compiles the real issue but sends nothing and records nothing — the loop you want while
          editing prompts. */}
      <a
        href={`/api/digests/${digestId}/preview`}
        target="_blank"
        rel="noreferrer"
        className="rounded border border-rule px-3 py-1.5 font-mono text-sm hover:border-ink"
      >
        Preview
      </a>
      <button
        onClick={() => run(true)}
        disabled={busy}
        className="rounded border border-rule px-3 py-1.5 font-mono text-sm hover:border-ink disabled:opacity-50"
        title="Rebuild today even if it was already delivered, and send it again"
      >
        Regenerate
      </button>
      <button
        onClick={() => run(false)}
        disabled={busy}
        className="rounded border border-ink px-3 py-1.5 font-mono text-sm disabled:opacity-50"
      >
        {busy ? "building…" : "Run now"}
      </button>
    </div>
  );
}
