import { Link } from "react-router-dom";
import { ArrowLeft, Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { 
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
} from "@/components/ui/breadcrumb";
import { NavBreadcrumbProps } from "./types";

export const NavBreadcrumb = ({ bookName, pageName, location, navigate }: NavBreadcrumbProps) => {
  const isBookRoute = location.pathname.includes('/book/');
  const isPageRoute = location.pathname.includes('/page/');
  const isBookEditRoute = location.pathname.endsWith('/edit');
  const isNewBookRoute = location.pathname.endsWith('/book/new');
  const showBackButton = location.pathname !== '/';

  if (!isBookRoute) {
    return (
      <Link to={`/`}>
        <span className="text-lg font-semibold text-foreground">Pensive</span>
      </Link>
    );
  }

  return (
    <Breadcrumb>
      <BreadcrumbList className="flex flex-row items-center min-w-0">
        <div className="flex items-center">
          {showBackButton && (
            <BreadcrumbItem className="shrink-0">
              <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </BreadcrumbItem>
          )}
          <BreadcrumbItem className="flex items-center min-w-0">
            <Link 
              className="text-blue-500 hover:text-blue-600 transition-colors font-medium shrink-0" 
              to={`/my-books`}
            >
              <Library className="h-5 w-5" />
            </Link>
            <span className="mx-2 text-muted-foreground shrink-0">›</span>
            {isPageRoute ? (
              <>
                <Link 
                  className="text-blue-500 hover:text-blue-600 transition-colors font-medium truncate max-w-[120px] md:max-w-[200px]"
                  to={`/book/${location.pathname.split('/')[2]}`}
                >
                  {bookName}
                </Link>
                <span className="mx-2 text-muted-foreground shrink-0">›</span>
                <span className="text-foreground font-medium truncate max-w-[120px] md:max-w-[200px]">
                  {pageName}
                </span>
              </>
            ) : (
              <>
                {isBookEditRoute ? (
                  <>
                    <Link 
                      className="text-blue-500 hover:text-blue-600 transition-colors font-medium truncate max-w-[300px]"
                      to={`/book/${location.pathname.split('/')[2]}`}
                    >
                      {bookName}
                    </Link>
                    <span className="mx-2 text-muted-foreground shrink-0">›</span>
                    <span className="text-foreground font-medium">Edit Book</span>
                  </>
                ) : isNewBookRoute ? (
                  <span className="text-foreground font-medium">New Book</span>
                ) : (
                  <span className="text-foreground font-medium truncate max-w-[300px]">{bookName}</span>
                )}
              </>
            )}
          </BreadcrumbItem>
        </div>
      </BreadcrumbList>
    </Breadcrumb>
  );
}; 