"use client";

import Link from "next/link";
import { useCookieConsent } from "@/lib/cookie-consent";

const primaryButton =
  "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const outlineButton =
  "inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function CookieBanner() {
  const { consent, hydrated, accept, reject } = useCookieConsent();

  if (!hydrated || consent !== "unknown") return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="container max-w-5xl mx-auto px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          We use essential cookies to keep the site working, and optional
          analytics cookies (Google Analytics) to understand how Pensive is
          used. See our{" "}
          <Link href="/cookies" className="underline underline-offset-4">
            cookie policy
          </Link>
          .
        </p>
        <div className="flex gap-2 shrink-0">
          <button type="button" className={outlineButton} onClick={reject}>
            Reject
          </button>
          <button type="button" className={primaryButton} onClick={accept}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
