
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { NavTabsProps } from "./types";
import { Wand2 } from "lucide-react";

export const NavTabs = ({ isLibraryActive, isMyBooksActive }: NavTabsProps) => {
  if (!isLibraryActive && !isMyBooksActive) {
    return null;
  }
  
  return (
    <div className="bg-background border-b">
      <div className="container max-w-7xl mx-auto">
        <div className="flex space-x-4">
          <Link
            to="/my-books"
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors relative",
              isMyBooksActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              isMyBooksActive && "after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-foreground"
            )}
          >
            My Books
          </Link>
          <Link
            to="/library"
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors relative",
              isLibraryActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              isLibraryActive && "after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-foreground"
            )}
          >
            Library
          </Link>
        </div>
      </div>
    </div>
  );
}; 
