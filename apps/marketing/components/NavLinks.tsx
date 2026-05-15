"use client";

import { usePathname } from "next/navigation";

export function NavLinks() {
  const pathname = usePathname();
  const isLibraryActive = pathname === "/library" || pathname.startsWith("/library/");

  return (
    <div className="flex items-center gap-6">
      <a href="/" className="text-lg font-semibold text-foreground">
        Pensive
      </a>
      <a
        href="/library"
        className={`relative text-sm transition-colors hover:text-foreground ${
          isLibraryActive
            ? "text-foreground after:absolute after:-bottom-0.5 after:left-0 after:h-0.5 after:w-full after:bg-foreground"
            : "text-muted-foreground"
        }`}
      >
        Library
      </a>
    </div>
  );
}
