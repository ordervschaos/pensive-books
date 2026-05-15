import { LogIn } from "lucide-react";
import { getConfiguredAppOrigin } from "@/lib/pensive";
import { PublicThemeMenu } from "@/components/PublicThemeMenu";

export function PublicTopNav() {
  const appOrigin = getConfiguredAppOrigin();

  return (
    <nav className="sticky top-0 z-50 border-b bg-background">
      <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <a href="/" className="text-lg font-semibold text-foreground">
          Pensive
        </a>

        <div className="flex items-center gap-3">
          <PublicThemeMenu />
          <a
            href={`${appOrigin}/auth`}
            aria-label="Log in"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-input bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogIn className="h-5 w-5" />
          </a>
        </div>
      </div>
    </nav>
  );
}
