// Minimal Sentry envelope reporter for Deno edge functions.
// No SDK dependency — POSTs directly to the Sentry HTTP envelope API.
const DSN = Deno.env.get("SENTRY_DSN") ?? "https://3277231a82305aa94d458ba9d79d10fb@o4508145966514176.ingest.us.sentry.io/4508145967431680";

function parseDsn(dsn: string) {
  const url = new URL(dsn);
  return {
    key: url.username,
    project: url.pathname.slice(1),
    endpoint: `${url.protocol}//${url.hostname}/api/${url.pathname.slice(1)}/envelope/`,
  };
}

export async function captureException(
  err: unknown,
  tags?: Record<string, string>,
  extra?: Record<string, unknown>,
) {
  try {
    const { key, endpoint } = parseDsn(DSN);
    const error = err instanceof Error ? err : new Error(String(err));
    const eventId = crypto.randomUUID().replace(/-/g, "");

    const envelope = [
      JSON.stringify({ sent_at: new Date().toISOString(), dsn: DSN }),
      JSON.stringify({ type: "event" }),
      JSON.stringify({
        event_id: eventId,
        timestamp: new Date().toISOString(),
        platform: "javascript",
        level: "error",
        environment: Deno.env.get("ENVIRONMENT") ?? "production",
        exception: {
          values: [{
            type: error.name || "Error",
            value: error.message,
            mechanism: { type: "generic", handled: false },
          }],
        },
        tags,
        extra,
      }),
    ].join("\n");

    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_key=${key}, sentry_version=7`,
      },
      body: envelope,
    });
  } catch {
    // Never let error reporting throw
  }
}

export function isBillingError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("credit balance") || msg.includes("insufficient_quota") || msg.includes("x-stainless");
}
