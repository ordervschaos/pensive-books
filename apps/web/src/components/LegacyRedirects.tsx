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

  // Redirect split-slug book URLs: /books/<id>/<-name>(/<rest>) → /books/<id-name>(/<rest>)
  // Fires before the studio guard — the studio guard only protects singular→plural rewrites below.
  const splitSlug = pathname.match(/^\/books\/(\d+)\/(-[^/]+)(\/.*)?$/);
  if (splitSlug) {
    return <Navigate to={`/books/${splitSlug[1]}${splitSlug[2]}${splitSlug[3] ?? ''}${search}${hash}`} replace />;
  }

  // The DNA studio defines its own CRUD-compliant URL space (/books/:slug/dna, /dna/tree/*, /dna/meters,
  // /dna/ledger, /dna.json). It is not a legacy surface — bail before the singular→plural rewrites below
  // could mangle any future /dna/.../page/... sub-route into a non-existent /pages/ path (blank screen).
  if (pathname.includes('/dna')) {
    return null;
  }

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
