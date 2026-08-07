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

  // The studio was renamed from "DNA" to "Studio" (2026-08-07) and moved into its own /studio
  // namespace. Old bookmarked/shared links still point at /dna/... — redirect them into the new
  // shape before the singular→plural rewrites below, which would otherwise mangle a
  // /dna/tree/page/... sub-route into a non-existent /pages/ path (blank screen).
  if (pathname === '/books/dna/new') {
    return <Navigate to={`/studio/new${search}${hash}`} replace />;
  }
  const legacyDna = pathname.match(/^(\/books\/[^/]+)\/dna(\.json)?(\/.*)?$/);
  if (legacyDna) {
    const [, bookPath, jsonExt, rest] = legacyDna;
    const newPath = jsonExt ? `${bookPath}/studio.json` : `${bookPath}/studio${rest ?? ''}`;
    return <Navigate to={`${newPath}${search}${hash}`} replace />;
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
