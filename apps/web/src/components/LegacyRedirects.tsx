import { Navigate, useLocation } from 'react-router-dom';

/**
 * LegacyRedirects - Redirects old URL patterns to new CRUD-compliant URLs
 *
 * This component handles backward compatibility for old bookmarked URLs
 * and external links that use the old singular routes.
 */
export function LegacyRedirects() {
  const location = useLocation();
  const { pathname, search, hash } = location;

  // Redirect /book/ to /books/
  if (pathname.includes('/book/')) {
    const newPath = pathname.replace('/book/', '/books/');
    return <Navigate to={`${newPath}${search}${hash}`} replace />;
  }

  // Redirect /page/ to /pages/ (in context of books)
  if (pathname.includes('/books/') && pathname.includes('/page/')) {
    const newPath = pathname.replace('/page/', '/pages/');
    return <Navigate to={`${newPath}${search}${hash}`} replace />;
  }

  // Redirect /version/ to /versions/ (in context of books)
  if (pathname.includes('/books/') && pathname.includes('/version/')) {
    const newPath = pathname.replace('/version/', '/versions/');
    return <Navigate to={`${newPath}${search}${hash}`} replace />;
  }

  // Redirect /my-books to /books
  if (pathname === '/my-books') {
    return <Navigate to={`/books${search}${hash}`} replace />;
  }

  return null;
}
