import { Helmet } from 'react-helmet-async';

interface PageMetaProps {
  page: {
    title: string;
    html_content: string;
  };
  book: {
    name: string;
    cover_url?: string;
    author?: string;
    published_at?: string;
  };
}

/**
 * Extract first 160 characters of text from HTML for meta description
 */
const getTextPreview = (htmlContent: string): string => {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlContent || '';

  const textContent = tempDiv.textContent || '';
  return textContent.substring(0, 160) + (textContent.length > 160 ? '...' : '');
};

/**
 * Component to handle all SEO meta tags for a page
 * Manages: document title, description, Open Graph, Twitter Card, article metadata
 */
export const PageMeta = ({ page, book }: PageMetaProps) => {
  const currentUrl = window.location.href;
  const coverImageUrl = book.cover_url
    ? new URL(book.cover_url, window.location.origin).toString()
    : `${window.location.origin}/default-book-cover.png`;

  const pageDescription = getTextPreview(page.html_content || '');
  const pageTitle = `${page.title} - ${book.name}`;

  return (
    <Helmet>
      {/* Standard meta tags */}
      <title>{pageTitle}</title>
      <meta name="title" content={pageTitle} />
      <meta name="description" content={pageDescription} />

      {/* Open Graph (Facebook, LinkedIn) */}
      <meta property="og:type" content="article" />
      <meta property="og:url" content={currentUrl} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={pageDescription} />
      <meta property="og:image" content={coverImageUrl} />

      {/* Twitter Card */}
      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content={currentUrl} />
      <meta property="twitter:title" content={pageTitle} />
      <meta property="twitter:description" content={pageDescription} />
      <meta property="twitter:image" content={coverImageUrl} />

      {/* Article metadata */}
      {book.author && <meta property="article:author" content={book.author} />}
      {book.published_at && <meta property="article:published_time" content={book.published_at} />}
    </Helmet>
  );
};
