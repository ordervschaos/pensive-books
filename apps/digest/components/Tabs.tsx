"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

// The tabs are routes, not client state: each one is a real URL that server-renders on its own. That keeps
// them shareable and back-button-correct, and means the only thing this component needs to be a client
// component for is knowing which one is active.
export interface Tab {
  label: string;
  href: string;
}

export function Tabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();

  return (
    <nav className="-mb-px flex gap-6 border-b border-rule">
      {tabs.map((t) => {
        // Longest match wins, so /digests/1/posts doesn't also light up the /digests/1 index tab.
        const active =
          tabs.reduce((best, x) => (pathname === x.href || pathname.startsWith(`${x.href}/`) ? (x.href.length > best.length ? x.href : best) : best), "") ===
          t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 pb-2 font-mono text-sm ${
              active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
