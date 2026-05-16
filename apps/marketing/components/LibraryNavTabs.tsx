"use client";

import { usePathname } from "next/navigation";
import { NavTabs as SharedNavTabs } from "@pensive/shared/ui/nav-tabs";

type Props = {
  appOrigin: string;
};

export function LibraryNavTabs({ appOrigin }: Props) {
  const pathname = usePathname();

  if (!pathname.startsWith("/library")) {
    return null;
  }

  return (
    <SharedNavTabs
      tabs={[
        { label: "My Books", href: `${appOrigin}/books`, active: false },
        { label: "Library", href: "/library", active: true },
      ]}
    />
  );
}
