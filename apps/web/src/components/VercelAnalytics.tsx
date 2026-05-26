import { Analytics } from "@vercel/analytics/react";
import { useCookieConsent } from "@/hooks/useCookieConsent";

export function VercelAnalytics() {
  const { consent } = useCookieConsent();
  if (consent !== "accepted") return null;
  return <Analytics />;
}
