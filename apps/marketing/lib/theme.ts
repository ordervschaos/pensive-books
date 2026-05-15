export const THEME_NAME_KEY = "themeName";
export const THEME_MODE_KEY = "themeMode";

function isSharedProductionDomain(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.location.hostname === "pensive.me" ||
      window.location.hostname.endsWith(".pensive.me"))
  );
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string) {
  const domain = isSharedProductionDomain() ? "; domain=.pensive.me" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax; max-age=31536000${domain}`;
}

export function readThemeValue(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getCookie(key) ?? window.localStorage.getItem(key) ?? fallback;
}

export function writeThemeValue(key: string, value: string) {
  setCookie(key, value);
  window.localStorage.setItem(key, value);
}
