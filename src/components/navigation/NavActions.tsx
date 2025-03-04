import { LogOut, LogIn, Moon, Sun, Search, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NavActionsProps } from "./types";

export const NavActions = ({ 
  isAuthenticated, 
  isBookRoute, 
  theme, 
  toggleTheme, 
  handleLogout, 
  handleLogin, 
  setSearchOpen 
}: NavActionsProps) => {
  return (
    <div className="w-[120px] flex items-center gap-2 justify-end shrink-0">
      {/* Desktop buttons */}
      <div className="hidden sm:flex items-center gap-2">
        {isBookRoute && (
          <Button variant="ghost" size="icon" onClick={() => setSearchOpen(true)}>
            <Search className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={toggleTheme}>
          {theme === "light" ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </Button> 
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
            {isBookRoute && (
              <DropdownMenuItem onClick={() => setSearchOpen(true)}>
                <Search className="h-4 w-4 mr-2" />
                <span>Search</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={toggleTheme}>
              {theme === "light" ? (
                <>
                  <Moon className="h-4 w-4 mr-2" />
                  <span>Dark mode</span>
                </>
              ) : (
                <>
                  <Sun className="h-4 w-4 mr-2" />
                  <span>Light mode</span>
                </>
              )}
            </DropdownMenuItem>
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