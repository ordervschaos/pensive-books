# Open Graph Meta Tags Implementation

This document explains how Open Graph meta tags are implemented in the Pensive Books application to ensure proper display of book and page content when shared on social media platforms.

## Overview

Open Graph meta tags are HTML meta tags that control how URLs are displayed when shared on social media. They're part of Facebook's Open Graph protocol and are also used by other platforms like Twitter, LinkedIn, and more.

## Implementation

We've implemented Open Graph meta tags in two main components:

1. **BookDetails.tsx** - For when a book's main page is shared
2. **PageView.tsx** - For when a specific page within a book is shared

## Meta Tags Used

The following Open Graph meta tags are implemented:

- `og:title` - The title of the book or page
- `og:description` - A brief description of the book or page content
- `og:image` - The book's cover image
- `og:url` - The current URL of the page
- `og:type` - Either "book" for book details or "article" for pages
- Additional tags like `book:author`, `book:release_date`, `article:author`, and `article:published_time` when applicable

## Twitter Card Support

In addition to Open Graph meta tags, we've also implemented Twitter Card meta tags to ensure proper display on Twitter:

- `twitter:card` - Set to "summary_large_image" to display a large image
- `twitter:title` - The title of the book or page
- `twitter:description` - A brief description of the book or page content
- `twitter:image` - The book's cover image

## Implementation Details

We use React Helmet (react-helmet-async) to dynamically set these meta tags based on the current book or page being viewed. This ensures that the correct information is always displayed when a link is shared.

### Example (BookDetails.tsx):

```tsx
<Helmet>
  {/* Primary Meta Tags */}
  <title>{book.name} | Pensive</title>
  <meta name="title" content={`${book.name} | Pensive`} />
  <meta name="description" content={bookDescription} />
  
  {/* Open Graph / Facebook */}
  <meta property="og:type" content="book" />
  <meta property="og:url" content={currentUrl} />
  <meta property="og:title" content={`${book.name} | Pensive`} />
  <meta property="og:description" content={bookDescription} />
  <meta property="og:image" content={coverImageUrl} />
  
  {/* Twitter */}
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:url" content={currentUrl} />
  <meta property="twitter:title" content={`${book.name} | Pensive`} />
  <meta property="twitter:description" content={bookDescription} />
  <meta property="twitter:image" content={coverImageUrl} />
  
  {/* Book-specific metadata */}
  {book.author && <meta property="book:author" content={book.author} />}
  {book.published_at && <meta property="book:release_date" content={book.published_at} />}
</Helmet>
```

## Testing

You can test the Open Graph meta tags using:

1. [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/)
2. [Twitter Card Validator](https://cards-dev.twitter.com/validator)
3. [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/)

We've also created utility functions in `src/utils/metaTags.ts` to help validate the presence of Open Graph meta tags:

```tsx
import { validateOpenGraphTags, getOpenGraphTags } from '@/utils/metaTags';

// Check if all required Open Graph tags are present
const validation = validateOpenGraphTags();
console.log('OG Tags valid:', validation.valid);
if (!validation.valid) {
  console.log('Missing tags:', validation.missing);
}

// Get all current Open Graph tags
const currentTags = getOpenGraphTags();
console.log('Current OG Tags:', currentTags);
``` 