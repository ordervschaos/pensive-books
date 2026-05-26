"use client";

import { Analytics } from "@vercel/analytics/next";
import { useCookieConsent } from "@/lib/cookie-consent";

export function VercelAnalytics() {
  const { consent } = useCookieConsent();
  if (consent !== "accepted") return null;
  return <Analytics />;
}
