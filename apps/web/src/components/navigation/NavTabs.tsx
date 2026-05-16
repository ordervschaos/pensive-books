import { useLocation } from "react-router-dom";
import { Link } from "react-router-dom";
import { buildPublicUrl } from "@/utils/publicOrigin";

export function NavTabs() {
  const { pathname } = useLocation();

  if (pathname !== "/books") {
    return null;
  }

  const tabClass = "relative px-4 py-2 text-sm font-medium transition-colors";
  const activeClass =
    "text-foreground after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-foreground";
  const inactiveClass = "text-muted-foreground hover:text-foreground";

  return (
    <div className="border-b bg-background">
      <div className="container mx-auto max-w-7xl">
        <div className="flex space-x-4">
          <Link to="/books" className={`${tabClass} ${activeClass}`}>
            My Books
          </Link>
          <a href={buildPublicUrl("/library")} className={`${tabClass} ${inactiveClass}`}>
            Library
          </a>
        </div>
      </div>
    </div>
  );
}
