import { useEffect, useState } from "react";

export type ConsentValue = "unknown" | "accepted" | "rejected";

const STORAGE_KEY = "pensive.cookie-consent";
const EVENT_NAME = "pensive:cookie-consent-change";

function readConsent(): ConsentValue {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "accepted" || v === "rejected" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

function writeConsent(value: ConsentValue) {
  try {
    if (value === "unknown") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Ignore storage failures (private mode, quota, etc.) — UI still updates via event.
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: value }));
}

// Best-effort removal of GA cookies after the user withdraws consent.
// GA sets these on the eTLD+1, so we expire them on the current host and on
// each parent domain we can derive.
function clearAnalyticsCookies() {
  const names = document.cookie
    .split(";")
    .map((c) => c.split("=")[0]?.trim())
    .filter((n): n is string => !!n && (n === "_ga" || n.startsWith("_ga_") || n === "_gid" || n === "_gat"));

  const host = window.location.hostname;
  const parts = host.split(".");
  const domains = ["", host];
  for (let i = 1; i < parts.length - 1; i++) {
    domains.push("." + parts.slice(i).join("."));
  }
  domains.push("." + parts.slice(-2).join("."));

  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${
        domain ? `; domain=${domain}` : ""
      }`;
    }
  }
}

export function useCookieConsent() {
  const [consent, setConsent] = useState<ConsentValue>(() => readConsent());

  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<ConsentValue>).detail ?? readConsent();
      setConsent(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setConsent(readConsent());
    };
    window.addEventListener(EVENT_NAME, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return {
    consent,
    accept: () => writeConsent("accepted"),
    reject: () => {
      writeConsent("rejected");
      clearAnalyticsCookies();
    },
    reset: () => writeConsent("unknown"),
  };
}
