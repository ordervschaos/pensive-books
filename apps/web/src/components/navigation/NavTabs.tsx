import { useLocation } from "react-router-dom";
import { NavTabs as SharedNavTabs } from "@pensive/shared/ui/nav-tabs";
import { buildPublicUrl } from "@/utils/publicOrigin";

export function NavTabs() {
  const { pathname } = useLocation();

  if (pathname !== "/books") {
    return null;
  }

  return (
    <SharedNavTabs
      tabs={[
        { label: "My Books", href: "/books", active: true },
        { label: "Library", href: buildPublicUrl("/library"), active: false },
      ]}
    />
  );
}
