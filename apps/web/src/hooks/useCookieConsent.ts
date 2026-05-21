import { useEffect, useState } from "react";

export type ConsentValue = "unknown" | "accepted" | "rejected";

const COOKIE_NAME = "pensive.cookie-consent";
const LEGACY_STORAGE_KEY = "pensive.cookie-consent";
const EVENT_NAME = "pensive:cookie-consent-change";
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function cookieDomain(): string {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || !host.includes(".")) return "";
  const parts = host.split(".");
  return "." + parts.slice(-2).join(".");
}

function readConsent(): ConsentValue {
  try {
    const match = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(COOKIE_NAME + "="));
    const v = match?.split("=")[1]?.trim();
    return v === "accepted" || v === "rejected" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

function writeConsent(value: ConsentValue) {
  try {
    const domain = cookieDomain();
    const domainAttr = domain ? `; domain=${domain}` : "";
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    if (value === "unknown") {
      document.cookie = `${COOKIE_NAME}=; max-age=0; path=/${domainAttr}${secure}; SameSite=Lax`;
    } else {
      document.cookie = `${COOKIE_NAME}=${value}; max-age=${MAX_AGE}; path=/${domainAttr}${secure}; SameSite=Lax`;
    }
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: value }));
}

// Migrate a previously-stored localStorage value into the shared cookie once.
function migrateFromLocalStorage(): ConsentValue {
  try {
    const v = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (v === "accepted" || v === "rejected") {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      writeConsent(v);
      return v;
    }
  } catch {
    // ignore
  }
  return "unknown";
}

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
  const [consent, setConsent] = useState<ConsentValue>(() => {
    const fromCookie = readConsent();
    return fromCookie !== "unknown" ? fromCookie : migrateFromLocalStorage();
  });

  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<ConsentValue>).detail ?? readConsent();
      setConsent(next);
    };
    window.addEventListener(EVENT_NAME, onChange);
    return () => {
      window.removeEventListener(EVENT_NAME, onChange);
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
