import { getConfiguredAppOrigin } from "@/lib/pensive";
import { PublicThemeMenu } from "@/components/PublicThemeMenu";
import { NavLinks } from "@/components/NavLinks";
import { AuthButton } from "@/components/AuthButton";

export function PublicTopNav() {
  const appOrigin = getConfiguredAppOrigin();

  return (
    <nav className="sticky top-0 z-50 border-b bg-background">
      <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <NavLinks />

        <div className="flex items-center gap-3">
          <PublicThemeMenu />
          <AuthButton appOrigin={appOrigin} />
        </div>
      </div>
    </nav>
  );
}
