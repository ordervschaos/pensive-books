import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { buildPublicUrl } from "@/utils/publicOrigin";

interface PublicSiteRedirectProps {
  path?: string;
}

export function PublicSiteRedirect({ path }: PublicSiteRedirectProps) {
  const location = useLocation();

  useEffect(() => {
    const pathname = path ?? location.pathname;
    const target = buildPublicUrl(`${pathname}${location.search}${location.hash}`);
    window.location.replace(target);
  }, [location.hash, location.pathname, location.search, path]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
      Redirecting…
    </div>
  );
}
