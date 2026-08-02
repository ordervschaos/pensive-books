"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// The rail. A conversation with something that can do everything this app's forms can do.
//
// Two things it deliberately shows that a chat window normally hides:
//
//   - **every tool call, named, with its arguments.** The agent edits the reader's actual configuration, so
//     "Added a feed section" as prose is a claim, while `add_feed_section {...}` is a receipt. When the two
//     disagree the receipt is right, and the reader should be able to see which is which.
//   - **errors as steps, not as failures.** A refused write is information — usually a real constraint —
//     and hiding it would leave the model's summary as the only account of a turn that didn't do what it
//     said. Errors are marked, not swallowed.
//
// The steps also make the wait legible. A turn takes 7–16s, and "it is on its third tool call" is a much
// better answer to "is this stuck?" than a spinner is. (For now they arrive together at the end; streaming
// them as they happen is the next change and needs no new runtime — see the route handler.)

import type { Exchange } from "@/lib/digest/agent/transcript";

export function AgentRail({
  digestId,
  initialChatId,
  initialExchanges,
}: {
  digestId: number;
  initialChatId: number | null;
  initialExchanges: Exchange[];
}) {
  const router = useRouter();
  const [chatId, setChatId] = useState<number | null>(initialChatId);
  const [exchanges, setExchanges] = useState<Exchange[]>(initialExchanges);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [exchanges, busy]);

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;
    setDraft("");
    setBusy(true);
    setExchanges((prev) => [...prev, { message, steps: [] }]);

    try {
      const res = await fetch(`/api/digests/${digestId}/agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, chatId }),
      });
      const data = await res.json();

      setExchanges((prev) => {
        const next = [...prev];
        next[next.length - 1] = res.ok
          ? { message, text: data.text, steps: data.steps ?? [] }
          : { message, steps: [], error: data.error ?? "Something went wrong." };
        return next;
      });
      if (data.chatId) setChatId(data.chatId);
      // The agent writes through the same commands the forms use, so the other tabs are now stale. This is
      // the RSC equivalent of the house "refresh is a no-op" rule: the server components re-render, and the
      // reader never has to wonder whether what they're looking at is current.
      if (data.changed) router.refresh();
    } catch (e) {
      setExchanges((prev) => {
        const next = [...prev];
        next[next.length - 1] = { message, steps: [], error: String((e as Error).message ?? e) };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-6">
        {exchanges.length === 0 && (
          <div className="space-y-2 text-sm text-muted">
            <p>Ask for a change, or ask what&apos;s wrong. It can do anything the tabs can.</p>
            <ul className="space-y-1 font-mono text-xs">
              <li>“What&apos;s in this digest, and is anything about to silently fail?”</li>
              <li>“Add Stratechery&apos;s feed, weekly on Mondays.”</li>
              <li>“Which of my feeds are serving old writing?”</li>
            </ul>
          </div>
        )}

        {exchanges.map((x, i) => (
          <div key={i} className="space-y-3">
            <p className="border-l-2 border-rule pl-3 text-sm">{x.message}</p>

            {x.steps.length > 0 && (
              <ul className="space-y-1">
                {x.steps.map((s, j) => (
                  <li key={j} className="font-mono text-xs text-muted">
                    <span className={s.isError ? "text-ink" : ""}>{s.isError ? "✗" : "·"}</span> {s.tool}
                    {Object.keys(s.input).length > 0 && (
                      <span className="opacity-70"> {JSON.stringify(s.input)}</span>
                    )}
                    {s.isError && <span className="block pl-4">{s.result}</span>}
                  </li>
                ))}
              </ul>
            )}

            {x.text && <div className="whitespace-pre-wrap text-sm">{x.text}</div>}
            {x.error && (
              <p className="rounded border border-ink/25 bg-white p-3 text-sm">{x.error}</p>
            )}
          </div>
        ))}

        {busy && <p className="font-mono text-xs text-muted">working…</p>}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 border-t border-rule pt-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, shift+enter breaks the line — the composer convention, and the messages here are
            // one or two sentences far more often than they are paragraphs.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Ask for a change…"
          disabled={busy}
          className="w-full rounded border border-rule bg-white px-3 py-2 text-sm disabled:opacity-60"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !draft.trim()}
          className="shrink-0 self-end rounded bg-ink px-4 py-2 font-mono text-sm text-paper disabled:opacity-40"
        >
          send
        </button>
      </div>
    </div>
  );
}
