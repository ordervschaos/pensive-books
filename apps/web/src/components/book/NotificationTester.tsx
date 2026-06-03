import { useState } from "react";
import { Bell, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isSupported, permission, requestPermission, notify } from "@/lib/notify";

/**
 * A diagnostic panel (author-only) for the two notification channels, since
 * "I'm not getting any" can fail at several layers. Each button isolates one:
 *   - Browser: request permission + fire a notification right now (client-only).
 *   - Email: hit test-notification-email, which sends straight to you via Mailgun
 *     and reports the real error — separating Mailgun/deliverability from the
 *     trigger → pg_net → notify-task-done chain.
 */
export function NotificationTester() {
  const [webMsg, setWebMsg] = useState<string | null>(null);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const testWeb = async () => {
    if (!isSupported()) {
      setWebMsg("This browser doesn't support notifications (on iOS, install the app to your home screen first).");
      return;
    }
    let perm = permission();
    if (perm === "default") perm = await requestPermission();
    if (perm !== "granted") {
      setWebMsg(`Permission is "${perm}". Allow notifications for this site in your browser, then try again.`);
      return;
    }
    setWebMsg('Permission "granted" — firing in 5s. Switch to another tab/app now to test whether it shows when this tab is NOT focused (some OSes suppress notifications for the focused tab).');
    setTimeout(() => {
      notify("Pensive — test notification", {
        body: "If you can see this, browser notifications work.",
        tag: "pensive-test",
      });
    }, 5000);
  };

  const testEmail = async () => {
    setSending(true);
    setEmailMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("test-notification-email");
      if (error) {
        // Surface the function's JSON error body (e.g. Mailgun sandbox rejection).
        let detail = error.message ?? "request failed";
        const ctx = (error as { context?: Response }).context;
        if (ctx) {
          try {
            const body = await ctx.json();
            detail = body?.mailgun || body?.error || detail;
            if (body?.isSandbox) detail += " — this is a Mailgun SANDBOX domain, which only delivers to authorized recipients.";
          } catch { /* keep default */ }
        }
        setEmailMsg(`Failed: ${detail}`);
        return;
      }
      const sandbox = (data as { isSandbox?: boolean })?.isSandbox;
      const to = (data as { to?: string })?.to;
      setEmailMsg(
        `Sent to ${to}. Check your inbox (and spam).` +
          (sandbox ? " ⚠️ Using a Mailgun SANDBOX domain — it only delivers to authorized recipients." : ""),
      );
    } catch (e) {
      setEmailMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-8 rounded-2xl border border-dashed border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30 p-5">
      <div className="pv-eyebrow">
        Notification test ·{" "}
        <span className="pv-serif text-[13px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-muted))]">
          author-only diagnostic
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={testWeb}>
          <Bell className="mr-2 h-4 w-4" /> Test browser notification
        </Button>
        <Button variant="outline" size="sm" onClick={testEmail} disabled={sending}>
          <Mail className="mr-2 h-4 w-4" /> {sending ? "Sending…" : "Test email"}
        </Button>
      </div>
      {webMsg && (
        <p className="pv-serif mt-3 text-[13px] leading-relaxed text-[hsl(var(--pv-text-muted))]">{webMsg}</p>
      )}
      {emailMsg && (
        <p className="pv-serif mt-1.5 text-[13px] leading-relaxed text-[hsl(var(--pv-text-muted))]">{emailMsg}</p>
      )}
    </div>
  );
}
