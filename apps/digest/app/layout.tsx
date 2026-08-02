import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pensive Digest",
  description: "A morning digest, compiled from sources you choose, delivered to your Kindle.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* `app-shell` is the full-width wrapper the docked agent rail pushes against (globals.css). The
            reading column stays centred inside whatever width is left, instead of the rail eating into it. */}
        <div className="app-shell">
          <div className="mx-auto max-w-3xl px-6 py-10">
            <header className="mb-10 flex items-baseline justify-between border-b border-rule pb-4">
              <a href="/" className="text-lg tracking-tight">
                Pensive <span className="text-muted">Digest</span>
              </a>
              <nav className="flex items-baseline gap-4 font-mono text-xs text-muted">
                <a href="/settings" className="hover:text-ink">
                  settings
                </a>
                <a href="https://app.pensive.me" className="hover:text-ink">
                  ← app
                </a>
              </nav>
            </header>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
