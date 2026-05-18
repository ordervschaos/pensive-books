import { LogOut, LogIn, Search, MoreVertical, Moon, Sun, Coffee, Palette, Package, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@pensive/shared/ui/icon-button";
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

  return (
    <>
      {/* Desktop buttons */}
      <div className="hidden sm:flex items-center gap-1">
        {isBookRoute && (
          <IconButton aria-label="Search" onClick={() => setSearchOpen(true)}>
            <Search className="h-4 w-4" />
          </IconButton>
        )}
        {isPageRoute && <PageDisplayControls isPageRoute={isPageRoute} />}
        <ThemeSwitcher />
        {isAuthenticated ? (
          <IconButton aria-label="Sign out" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
          </IconButton>
        ) : (
          <IconButton aria-label="Sign in" onClick={handleLogin}>
            <LogIn className="h-4 w-4" />
          </IconButton>
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
              onClick={() => setThemeName("paper")}
              className={themeName === "paper" ? "bg-accent" : ""}
            >
              <BookOpen className="h-4 w-4 mr-2" />
              <span>Paper</span>
            </DropdownMenuItem>
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
    </>
  );
};