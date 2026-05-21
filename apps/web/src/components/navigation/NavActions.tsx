import { Search } from "lucide-react";
import { IconButton } from "@pensive/shared/ui/icon-button";
import { NavActionsProps } from "./types";
import { PageDisplayControls } from "./PageDisplayControls";
import { AppearanceMenu } from "./AppearanceMenu";
import { UserMenu } from "./UserMenu";
import { useLocation } from "react-router-dom";

export const NavActions = ({
  isAuthenticated,
  isBookRoute,
  handleLogout,
  handleLogin,
  setSearchOpen
}: NavActionsProps) => {
  const location = useLocation();
  const isPageRoute = location.pathname.includes('/pages/');

  return (
    <div className="flex items-center gap-1">
      {isBookRoute && (
        <IconButton aria-label="Search" onClick={() => setSearchOpen(true)} className="border-none">
          <Search className="h-4 w-4" />
        </IconButton>
      )}
      {isPageRoute && <PageDisplayControls isPageRoute={isPageRoute} />}
      <AppearanceMenu />
      <UserMenu
        isAuthenticated={isAuthenticated}
        handleLogout={handleLogout}
        handleLogin={handleLogin}
      />
    </div>
  );
};
