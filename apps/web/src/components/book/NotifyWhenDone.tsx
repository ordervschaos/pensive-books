import { Check } from "lucide-react";
import { isSupported, permission, requestPermission } from "@/lib/notify";

/**
 * A small "Notify me when it's done" toggle for long AI tasks.
 *
 * One control, two channels:
 *   - email  — always; the parent persists the opt-in (a `notify_email` flag on
 *     the task row, or a flag passed to the task's edge function).
 *   - browser notification — best-effort; enabling requests permission inside
 *     this click (a real user gesture) and the parent fires it on completion.
 *
 * The component owns none of the persistence — it just reports the new `enabled`
 * state up via onChange, having already nudged for browser permission. If the
 * browser channel is unsupported or denied, we say so quietly; email still works.
 */
export function NotifyWhenDone({
  enabled,
  onChange,
  className,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  className?: string;
}) {
  const perm = permission();

  const toggle = async () => {
    const next = !enabled;
    // Turning it on is the one safe moment to ask the browser (we're in a click).
    if (next && isSupported() && permission() === "default") {
      await requestPermission();
    }
    onChange(next);
  };

  // What actually happens when it's on — set expectations honestly.
  const note = !enabled
    ? null
    : !isSupported()
      ? "by email"
      : perm === "denied"
        ? "by email (browser notifications are blocked)"
        : perm === "granted"
          ? "by email + browser notification"
          : "by email + browser notification";

  return (
    <button
      type="button"
      onClick={toggle}
      role="checkbox"
      aria-checked={enabled}
      className={`group inline-flex items-center gap-2 text-left transition-colors ${className ?? ""}`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          enabled
            ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-accent))] text-background"
            : "border-[hsl(var(--pv-text-faint))] group-hover:border-foreground"
        }`}
      >
        {enabled && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="pv-serif text-[13.5px] leading-tight text-foreground">
        Notify me when it&apos;s done
        {note && (
          <span className="ml-1 text-[hsl(var(--pv-text-faint))]">— {note}</span>
        )}
      </span>
    </button>
  );
}
