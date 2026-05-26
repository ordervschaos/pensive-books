"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TopNavShell, type TopNavTab } from "@pensive/shared/ui/top-nav";
import { getConfiguredAppOrigin } from "@/lib/pensive";
import { PublicAppearanceMenu } from "@/components/PublicAppearanceMenu";
import { PublicUserMenu } from "@/components/PublicUserMenu";

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

const crumbLinkClass = "hover:opacity-80 transition-opacity cursor-pointer";

function buildCrumb(pathname: string) {
  const match = pathname.match(/^\/library\/books\/([^/]+)$/);
  const libraryLink = <Link href="/library" className={crumbLinkClass}>The Library</Link>;
  if (!match) return libraryLink;
  return (
    <>
      {libraryLink}
      {"  /  "}
      <Link href={pathname} className={crumbLinkClass}>{deslug(match[1])}</Link>
    </>
  );
}

export function PublicTopNav() {
  const pathname = usePathname() ?? "/";
  const mode = pickMode(pathname);
  const appOrigin = getConfiguredAppOrigin();

  if (mode === "hidden") return null;

  const themeAndAuth = (
    <div className="flex items-center gap-1">
      <PublicAppearanceMenu />
      <PublicUserMenu appOrigin={appOrigin} />
    </div>
  );

  if (mode === "compact") {
    return (
      <TopNavShell
        mode="compact"
        logoHref="/"
        crumb={buildCrumb(pathname)}
        actions={themeAndAuth}
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
    <TopNavShell mode="full" logoHref="/" tabs={tabs} actions={themeAndAuth} />
  );
}
