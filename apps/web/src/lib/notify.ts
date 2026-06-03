/**
 * Browser notifications for long AI tasks — the foreground half of "Notify me
 * when it's done" (the other half is the server-sent email).
 *
 * Deliberately conservative because permission UX is fragile, especially on
 * mobile: a wrong call can throw or wedge the page. The rules baked in here:
 *   - feature-detect before touching the API,
 *   - only ever request permission from inside a user gesture (the caller's
 *     click handler — never on mount),
 *   - wrap every call so it can NEVER throw into the page.
 *
 * On platforms that don't support it (e.g. iOS Safari without an installed PWA),
 * `isSupported()` is false → callers simply don't offer the browser toggle, and
 * the email still covers the user.
 */

export function isSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function permission(): NotificationPermission | "unsupported" {
  if (!isSupported()) return "unsupported";
  try {
    return Notification.permission;
  } catch {
    return "unsupported";
  }
}

/**
 * Ask for permission. MUST be called from within a user gesture. Returns the
 * resulting permission, or "unsupported" if the API isn't available. Never throws.
 */
export async function requestPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isSupported()) return "unsupported";
  try {
    // Modern browsers return a promise; older Safari used a callback. Handle both.
    const result = Notification.requestPermission();
    if (result instanceof Promise) return await result;
    return await new Promise<NotificationPermission>((resolve) =>
      Notification.requestPermission(resolve),
    );
  } catch {
    return "denied";
  }
}

/**
 * Fire a notification if (and only if) permission is granted. Safe to call
 * unconditionally — no-ops when unsupported or not granted, swallows the
 * "Illegal constructor" some mobile contexts throw. Clicking focuses the tab
 * and navigates to `url` if given.
 */
export function notify(title: string, options?: { body?: string; url?: string; tag?: string }): void {
  try {
    if (!isSupported() || Notification.permission !== "granted") return;
    const n = new Notification(title, {
      body: options?.body,
      icon: "/favicon.ico",
      tag: options?.tag,
    });
    if (options?.url) {
      n.onclick = () => {
        try {
          window.focus();
          window.location.href = options.url!;
        } catch {
          /* ignore */
        }
      };
    }
  } catch {
    // Some mobile/in-app browsers throw on the constructor — never break the page.
  }
}
