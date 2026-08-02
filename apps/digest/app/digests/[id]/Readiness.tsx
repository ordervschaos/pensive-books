import type { Readiness, ReadinessNote } from "@/lib/digest/readiness";

// The readiness panel. Its whole job is to move a class of failure EARLIER: every note here describes
// something that would otherwise be discovered at 6am, from an issue that is missing a section and says
// nothing about why.
//
// It replaced the per-section ⚠ lines that used to sit inside each section card. Those were the same three
// checks (search/prompt need AI, readwise needs a token) written a second time in JSX — the multi-mirror
// shape this codebase keeps paying to remove. One derivation, one place it renders.

export function ReadinessPanel({ readiness }: { readiness: Readiness }) {
  const { notes, blocking, next } = readiness;

  // Silence is the reward. A digest with nothing wrong gets one quiet line, not a green panel congratulating
  // itself — a status surface you learn to ignore when it's fine is a status surface you ignore when it isn't.
  if (notes.length === 0) {
    return (
      <p className="font-mono text-xs text-muted">
        ✓ Ready — nothing here will be skipped at delivery.
      </p>
    );
  }

  return (
    <section
      className={`space-y-3 rounded border p-4 ${
        blocking > 0 ? "border-ink/25 bg-white" : "border-rule bg-white/50"
      }`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-mono text-xs uppercase tracking-wider text-muted">
          {blocking > 0 ? "Won't deliver as configured" : "Worth a look"}
        </h2>
        <span className="font-mono text-xs text-muted">
          {[blocking && `${blocking} blocking`, readiness.degrading && `${readiness.degrading} to review`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>

      <ul className="space-y-2">
        {notes.map((n, i) => (
          <Note key={`${n.sectionId ?? "digest"}-${i}`} note={n} />
        ))}
      </ul>

      {/* Only worth a line when there's a choice to make. With a single note it would restate the list. */}
      {next && notes.length > 1 && (
        <p className="border-t border-rule pt-3 text-sm text-muted">Start here: {next}</p>
      )}
    </section>
  );
}

function Note({ note }: { note: ReadinessNote }) {
  return (
    <li className="flex gap-2 text-sm">
      {/* Two marks, not a colour: this app is print-ish and reads on paper-white. ⚠ = it won't run at all. */}
      <span aria-hidden className="select-none font-mono text-xs text-muted">
        {note.level === "blocking" ? "⚠" : "·"}
      </span>
      <span>
        {note.title}
        <span className="block text-xs text-muted">
          {note.detail}
          {note.fix && (
            <>
              {" "}
              <a href={note.fix.href} className="underline">
                {note.fix.label}
              </a>
            </>
          )}
        </span>
      </span>
    </li>
  );
}
