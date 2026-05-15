"use client";

import { usePathname } from "next/navigation";

type Props = {
  appOrigin: string;
};

export function LibraryNavTabs({ appOrigin }: Props) {
  const pathname = usePathname();

  if (!pathname.startsWith("/library")) {
    return null;
  }

  const tabClass =
    "relative px-4 py-2 text-sm font-medium transition-colors";
  const activeClass =
    "text-foreground after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-foreground";
  const inactiveClass = "text-muted-foreground hover:text-foreground";

  return (
    <div className="border-b bg-background">
      <div className="container mx-auto max-w-7xl">
        <div className="flex space-x-4">
          <a href={`${appOrigin}/books`} className={`${tabClass} ${inactiveClass}`}>
            My Books
          </a>
          <a href="/library" className={`${tabClass} ${activeClass}`}>
            Library
          </a>
        </div>
      </div>
    </div>
  );
}
