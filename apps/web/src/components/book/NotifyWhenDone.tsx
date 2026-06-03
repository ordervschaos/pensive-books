import { Bell, BellRing } from "lucide-react";
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

  const note =
    enabled && !isSupported()
      ? "we'll email you"
      : enabled && perm === "denied"
        ? "browser blocked — we'll email you"
        : enabled
          ? "email + browser"
          : null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      className={`pv-mono inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.12em] transition-colors ${
        enabled
          ? "text-[hsl(var(--pv-accent))]"
          : "text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-text-muted))]"
      } ${className ?? ""}`}
    >
      {enabled ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
      {enabled ? "Notify me" : "Notify when done"}
      {note && (
        <span className="normal-case tracking-normal text-[hsl(var(--pv-text-faint))]">· {note}</span>
      )}
    </button>
  );
}
