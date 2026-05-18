"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { IconButton } from "@pensive/shared/ui/icon-button";
import { TopNavShell, type TopNavTab } from "@pensive/shared/ui/top-nav";
import { getConfiguredAppOrigin } from "@/lib/pensive";
import { PublicThemeMenu } from "@/components/PublicThemeMenu";
import { AuthButton } from "@/components/AuthButton";

type NavMode = "full" | "compact" | "hidden";

// `/library/books/<slug>/pages/<slug>` is the immersive reader — the page
// renders its own auto-hiding header, so the global nav stays out of the way.
// `/library/books/<slug>` is the book detail page — compact nav (crumb only).
// Everything else gets the full nav.
function pickMode(pathname: string): NavMode {
  if (/^\/library\/books\/[^/]+\/pages\//.test(pathname)) return "hidden";
  if (/^\/library\/books\/[^/]+$/.test(pathname)) return "compact";
  return "full";
}

function deslug(slug: string) {
  return slug
    .replace(/^\d+-/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildCrumb(pathname: string) {
  const match = pathname.match(/^\/library\/books\/([^/]+)$/);
  if (!match) return "The Library";
  return `The Library  /  ${deslug(match[1])}`;
}

export function PublicTopNav() {
  const pathname = usePathname() ?? "/";
  const mode = pickMode(pathname);
  const appOrigin = getConfiguredAppOrigin();

  if (mode === "hidden") return null;

  const themeAndAuth = (
    <>
      <PublicThemeMenu />
      <AuthButton appOrigin={appOrigin} />
    </>
  );

  if (mode === "compact") {
    return (
      <TopNavShell
        mode="compact"
        logoHref="/"
        crumb={buildCrumb(pathname)}
        actions={
          <>
            <IconButton aria-label="Search">
              <Search className="h-4 w-4" />
            </IconButton>
            {themeAndAuth}
          </>
        }
      />
    );
  }

  const tabs: TopNavTab[] = [
    {
      label: "My Books",
      href: `${appOrigin}/books`,
      active: false,
    },
    {
      label: "Library",
      href: "/library",
      active: pathname.startsWith("/library") || pathname === "/",
    },
  ];

  return (
    <TopNavShell
      mode="full"
      logoHref="/"
      tabs={tabs}
      search={{
        placeholder: "Search books, chapters, authors…",
        shortcut: "⌘K",
      }}
      actions={themeAndAuth}
    />
  );
}
