import * as Sentry from "@sentry/react";

const DSN = "https://3277231a82305aa94d458ba9d79d10fb@o4508145966514176.ingest.us.sentry.io/4508145967431680";

export function initSentry() {
  if (import.meta.env.DEV) return;
  Sentry.init({
    dsn: DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.consoleLoggingIntegration({ levels: ["error"] }),
    ],
    tracesSampleRate: 0.1,
    environment: "production",
    enableLogs: true,
  });
}

export const { captureException } = Sentry;

const AI_ERROR_PATTERNS = [
  "Claude API",
  "credit balance",
  "invalid_request_error",
  "anthropic",
  "x-api-key",
];

export function sanitizeAIError(msg: string, fallback = "AI service is temporarily unavailable."): string {
  const lower = msg.toLowerCase();
  if (AI_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()))) return fallback;
  return msg;
}
