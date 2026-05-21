import type { Metadata } from "next";
import { CookiePreferences } from "@/components/CookiePreferences";

export const metadata: Metadata = {
  title: "Cookie Policy | Pensive",
  description:
    "What cookies Pensive uses, what they're for, and how to change your preferences.",
};

export default function CookiesPage() {
  return (
    <div className="container max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold mb-8">Cookie Policy</h1>
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="p-6 prose prose-slate dark:prose-invert max-w-none">
          <p className="text-sm text-muted-foreground mb-4">
            Last updated: May 2026
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">What are cookies?</h2>
            <p>
              Cookies are small text files placed on your device when you visit
              a website. We also use similar technologies such as your
              browser's local storage.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">Cookies we use</h2>

            <h3 className="text-xl font-semibold mt-4 mb-2">
              Strictly necessary
            </h3>
            <p>
              Required for the site to function. They cannot be switched off
              and do not require your consent under EU law.
            </p>
            <ul className="list-disc pl-6">
              <li>
                <strong>themeName / themeMode</strong> — Remembers your theme
                choice so the page renders correctly on first paint.
              </li>
              <li>
                <strong>pensive.cookie-consent</strong> — Stored in your
                browser's local storage to remember your cookie choice on this
                device.
              </li>
            </ul>

            <h3 className="text-xl font-semibold mt-6 mb-2">
              Analytics (optional)
            </h3>
            <p>
              Loaded only if you accept. We use Google Analytics 4 to
              understand aggregate usage — which pages are visited, from which
              countries, and on what devices. We do not use this data to
              advertise to you.
            </p>
            <ul className="list-disc pl-6">
              <li>
                <strong>_ga, _ga_*</strong> — Google Analytics. Used to
                distinguish unique visitors. Expires after 2 years.
              </li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">Your choices</h2>
            <CookiePreferences />
            <p className="text-sm text-muted-foreground mt-4">
              You can change your mind at any time by returning to this page.
              Your choice is stored per-device.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Contact</h2>
            <p>
              Questions about cookies or privacy? Email us at
              toanzalansari@gmail.com.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
