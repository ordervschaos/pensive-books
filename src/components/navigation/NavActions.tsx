import { LogOut, LogIn, Search, MoreVertical, Moon, Sun, Coffee, Palette, Package, Pencil, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import { useTheme } from "@/components/theme/ThemeProvider";
import { NavActionsProps } from "./types";
import { PageDisplayControls } from "./PageDisplayControls";
import { useLocation } from "react-router-dom";
import { useGlobalEditMode } from "@/contexts/EditModeContext";

export const NavActions = ({
  isAuthenticated,
  isBookRoute,
  handleLogout,
  handleLogin,
  setSearchOpen
}: NavActionsProps) => {
  const { themeName, themeMode, setThemeName, setThemeMode } = useTheme();
  const location = useLocation();
  const isPageRoute = location.pathname.includes('/pages/');
  const { isEditing, setIsEditing, canEdit } = useGlobalEditMode();

  return (
    <div className="w-[120px] flex items-center gap-2 justify-end shrink-0">
      {/* Desktop buttons */}
      <div className="hidden sm:flex items-center gap-2">
        {/* Edit/Preview Switch - First in the list */}
        {isPageRoute && canEdit && (
          <div className="flex items-center gap-1 p-1 rounded-md border border-border bg-muted/50">
            <Button
              variant={isEditing ? "default" : "ghost"}
              size="sm"
              onClick={() => setIsEditing(true)}
              className={`h-7 px-2 text-xs ${!isEditing ? "hover:bg-transparent" : ""}`}
            >
              <Pencil className="h-3 w-3 mr-1" />
              Edit
            </Button>
            <Button
              variant={!isEditing ? "default" : "ghost"}
              size="sm"
              onClick={() => setIsEditing(false)}
              className={`h-7 px-2 text-xs ${isEditing ? "hover:bg-transparent" : ""}`}
            >
              <Eye className="h-3 w-3 mr-1" />
              Preview
            </Button>
          </div>
        )}
        {isBookRoute && (
          <Button variant="ghost" size="icon" onClick={() => setSearchOpen(true)}>
            <Search className="h-4 w-4" />
          </Button>
        )}
        {isPageRoute && <PageDisplayControls isPageRoute={isPageRoute} />}
        <ThemeSwitcher />
        {isAuthenticated ? (
          <Button variant="ghost" size="icon" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" onClick={handleLogin}>
            <LogIn className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Mobile menu */}
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Edit/Preview Switch - First in mobile menu */}
            {isPageRoute && canEdit && (
              <>
                <DropdownMenuLabel>Mode</DropdownMenuLabel>
                <div className="flex gap-1 p-2">
                  <Button
                    variant={isEditing ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIsEditing(true)}
                    className="flex-1 h-8 text-xs"
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant={!isEditing ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIsEditing(false)}
                    className="flex-1 h-8 text-xs"
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    Preview
                  </Button>
                </div>
                <DropdownMenuSeparator />
              </>
            )}

            {isBookRoute && (
              <DropdownMenuItem onClick={() => setSearchOpen(true)}>
                <Search className="h-4 w-4 mr-2" />
                <span>Search</span>
              </DropdownMenuItem>
            )}

            {isPageRoute && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Display Settings</DropdownMenuLabel>
                <PageDisplayControls isPageRoute={isPageRoute} mobile />
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => setThemeName("default")}
              className={themeName === "default" ? "bg-accent" : ""}
            >
              <Palette className="h-4 w-4 mr-2" />
              <span>Default</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setThemeName("coffee")}
              className={themeName === "coffee" ? "bg-accent" : ""}
            >
              <Coffee className="h-4 w-4 mr-2" />
              <span>Coffee</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setThemeName("mujiyish")}
              className={themeName === "mujiyish" ? "bg-accent" : ""}
            >
              <Package className="h-4 w-4 mr-2" />
              <span>Mujiyish</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Mode</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => setThemeMode("light")}
              className={themeMode === "light" ? "bg-accent" : ""}
            >
              <Sun className="h-4 w-4 mr-2" />
              <span>Light</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setThemeMode("dark")}
              className={themeMode === "dark" ? "bg-accent" : ""}
            >
              <Moon className="h-4 w-4 mr-2" />
              <span>Dark</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            {isAuthenticated ? (
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                <span>Logout</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={handleLogin}>
                <LogIn className="h-4 w-4 mr-2" />
                <span>Login</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}; 