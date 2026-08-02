"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Exchange } from "@/lib/digest/agent/transcript";

// The rail. A conversation with something that can do everything this app's forms can do, docked beside
// them rather than parked on a tab of its own — so the sections list visibly changes as the agent works.
//
// It lives in the PAGE MARGIN, not in the page. `position: fixed` against the viewport edge from `lg` up,
// with `.app-shell` padding to match (globals.css), so the centred reading column re-centres in the space
// that's left instead of being narrowed. The first cut made it a grid column inside the container, which
// took its width straight out of the content — the digest title wrapped onto two lines and a tab fell onto
// a second row. Below `lg` there is no spare margin to live in, so it stops being fixed and simply stacks
// under the page, which needs no drawer to build or maintain.
//
// Two things it deliberately shows that a chat window normally hides:
//
//   - **every tool call, named, with its arguments.** The agent edits the reader's actual configuration, so
//     "Added a feed section" as prose is a claim, while `add_feed_section {…}` is a receipt. When the two
//     disagree the receipt is right, and the reader should be able to see which is which.
//   - **errors as steps, not as failures.** A refused write is information — usually a real constraint —
//     and hiding it would leave the model's summary as the only account of a turn that didn't do what it
//     said. Errors are marked, not swallowed.
//
// The steps also make the wait legible. A turn takes 7–16s, and "it is on its third tool call" is a much
// better answer to "is this stuck?" than a spinner is. (For now they arrive together at the end; streaming
// them as they happen is the next change and needs no new runtime — see the route handler.)

const COLLAPSED_KEY = "digest-agent-collapsed";

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
  // Starts expanded and is read from storage after mount: the server has no idea what this reader chose
  // last time, and rendering one thing then correcting it is better than a hydration mismatch.
  const [collapsed, setCollapsed] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
  }, []);

  // The shell's gutter is CSS, keyed off an attribute this component owns — the alternative is lifting the
  // rail's open/closed state into a server layout that has no business knowing about it.
  useEffect(() => {
    document.body.dataset.agent = collapsed ? "closed" : "open";
    return () => {
      delete document.body.dataset.agent;
    };
  }, [collapsed]);

  useEffect(() => {
    if (!collapsed) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [exchanges, busy, collapsed]);

  function toggle() {
    setCollapsed((was) => {
      window.localStorage.setItem(COLLAPSED_KEY, was ? "0" : "1");
      return !was;
    });
  }

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
      // The agent writes through the same commands the forms use, so whatever tab is showing is now stale.
      // This is the RSC form of the house "refresh is a no-op" rule: the server components re-render in
      // place — including the sections list right next to this rail — and client state survives it.
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

  if (collapsed) {
    return (
      <button
        onClick={toggle}
        className="mt-10 block font-mono text-xs text-muted hover:text-ink lg:fixed lg:right-6 lg:top-10 lg:mt-0"
      >
        agent ▸
      </button>
    );
  }

  return (
    <aside className="mt-10 flex min-h-0 flex-col gap-3 border-t border-rule pt-6 lg:fixed lg:inset-y-0 lg:right-0 lg:mt-0 lg:w-[21rem] lg:border-l lg:border-t-0 lg:bg-paper lg:px-5 lg:py-8">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wider text-muted">Agent</h2>
        <div className="flex gap-3 font-mono text-xs text-muted">
          {exchanges.length > 0 && (
            <button
              onClick={() => {
                setExchanges([]);
                setChatId(null);
              }}
              className="hover:text-ink"
            >
              new
            </button>
          )}
          <button onClick={toggle} className="hover:text-ink">
            ◂
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
        {exchanges.length === 0 && (
          <div className="space-y-2 text-sm text-muted">
            <p>Ask for a change, or ask what&apos;s wrong. It can do anything these tabs can.</p>
            <ul className="space-y-1 font-mono text-xs">
              <li>“Is anything about to silently fail?”</li>
              <li>“Add Stratechery&apos;s feed, weekly on Mondays.”</li>
              <li>“Which feeds are serving old writing?”</li>
            </ul>
          </div>
        )}

        {exchanges.map((x, i) => (
          <div key={i} className="space-y-2">
            <p className="border-l-2 border-rule pl-3 text-sm">{x.message}</p>

            {x.steps.length > 0 && (
              <ul className="space-y-1">
                {x.steps.map((s, j) => (
                  <li key={j} className="break-words font-mono text-xs text-muted">
                    <span className={s.isError ? "text-ink" : ""}>{s.isError ? "✗" : "·"}</span> {s.tool}
                    {s.isError && <span className="block pl-4">{s.result}</span>}
                  </li>
                ))}
              </ul>
            )}

            {x.text && <div className="whitespace-pre-wrap text-sm">{x.text}</div>}
            {x.error && <p className="rounded border border-ink/25 bg-white p-2 text-sm">{x.error}</p>}
          </div>
        ))}

        {busy && <p className="font-mono text-xs text-muted">working…</p>}
        <div ref={endRef} />
      </div>

      <div className="space-y-2 border-t border-rule pt-3">
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
          rows={3}
          placeholder="Ask for a change…"
          disabled={busy}
          className="w-full rounded border border-rule bg-white px-3 py-2 text-sm disabled:opacity-60"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !draft.trim()}
          className="w-full rounded bg-ink px-4 py-2 font-mono text-sm text-paper disabled:opacity-40"
        >
          send
        </button>
      </div>
    </aside>
  );
}
