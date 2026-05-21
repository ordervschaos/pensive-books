"use client";

import { useCookieConsent } from "@/lib/cookie-consent";

const primaryButton =
  "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const outlineButton =
  "inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const ghostButton =
  "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function CookiePreferences() {
  const { consent, hydrated, accept, reject, reset } = useCookieConsent();

  const status = !hydrated
    ? "Loading…"
    : consent === "accepted"
      ? "Analytics accepted"
      : consent === "rejected"
        ? "Analytics rejected"
        : "Not set";

  return (
    <div>
      <p className="mb-4">
        Current setting: <strong>{status}</strong>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={consent === "accepted" ? primaryButton : outlineButton}
          onClick={accept}
        >
          Accept analytics
        </button>
        <button
          type="button"
          className={consent === "rejected" ? primaryButton : outlineButton}
          onClick={reject}
        >
          Reject analytics
        </button>
        {hydrated && consent !== "unknown" && (
          <button type="button" className={ghostButton} onClick={reset}>
            Reset choice
          </button>
        )}
      </div>
    </div>
  );
}
