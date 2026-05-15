function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

const LOCAL_PUBLIC_ORIGIN = "http://localhost:3000";
const PROD_PUBLIC_ORIGIN = "https://pensive.me";

export function getConfiguredPublicOrigin() {
  const configured = import.meta.env.VITE_PUBLIC_ORIGIN;
  if (configured) {
    return trimTrailingSlash(configured);
  }

  if (typeof window === "undefined") {
    return PROD_PUBLIC_ORIGIN;
  }

  const { hostname, protocol } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return LOCAL_PUBLIC_ORIGIN;
  }

  if (
    hostname === "pensive.me" ||
    hostname === "www.pensive.me" ||
    hostname === "app.pensive.me"
  ) {
    return PROD_PUBLIC_ORIGIN;
  }

  if (hostname.startsWith("app.")) {
    return `${protocol}//${hostname.slice(4)}`;
  }

  return `${protocol}//${hostname}`;
}

export function buildPublicUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getConfiguredPublicOrigin()}${normalizedPath}`;
}
