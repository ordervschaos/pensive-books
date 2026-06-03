import { useState } from "react";
import { Bell, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isSupported, permission, requestPermission } from "@/lib/notify";

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

  // Verbose on purpose: the real lib swallows errors, which hid why nothing
  // showed. Here we surface each step — permission, constructor throw, and the
  // onshow/onerror events — to separate "browser refused" from "OS suppressed".
  const testWeb = async () => {
    if (!isSupported()) {
      setWebMsg("This browser doesn't support the Notification API. On iOS you must install the app to your home screen (PWA) first; some in-app browsers also lack it.");
      return;
    }
    let perm = permission();
    if (perm === "default") perm = (await requestPermission()) as NotificationPermission;
    if (perm !== "granted") {
      setWebMsg(`Permission is "${perm}" — the browser won't show anything until you allow notifications for this site (and the request can't be re-shown once "denied"; reset it in the site settings / address-bar lock icon).`);
      return;
    }

    setWebMsg('Permission "granted". Firing in 5s — switch away if you like…');
    window.setTimeout(() => {
      let n: Notification;
      try {
        n = new Notification("Pensive — test notification", {
          body: "If you can see this, browser notifications work.",
          tag: "pensive-test",
        });
      } catch (err) {
        setWebMsg(
          `✗ new Notification() threw: ${err instanceof Error ? err.message : String(err)}. ` +
            "On Android Chrome / many mobile browsers this is expected — they require a service worker (Web Push), which this app doesn't have.",
        );
        return;
      }
      let shown = false;
      n.onshow = () => {
        shown = true;
        setWebMsg(
          "✓ onshow fired — the browser created and displayed the notification. If you still saw NOTHING on screen, the OS is suppressing the banner. On macOS: System Settings → Notifications → your browser → Allow Notifications ON + style Banners/Alerts, and turn OFF Focus / Do Not Disturb. In Chrome also check chrome://settings/content/notifications.",
        );
      };
      n.onerror = () => setWebMsg("✗ onerror fired — the browser refused to display it (often an OS-level block or a missing/blocked icon).");
      window.setTimeout(() => {
        if (!shown)
          setWebMsg(
            "⚠️ No onshow event after 3s — the browser didn't display it. Most likely OS-level suppression (macOS Focus/Do Not Disturb, or your browser is set to 'None'/blocked in System Settings → Notifications), or an aggressive notification setting in the browser itself.",
          );
      }, 3000);
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
