# Wiki-Link Feature

## Overview

The wiki-link feature allows you to create internal links between pages within a book using the `[[page title]]` syntax. This provides a simple and intuitive way to cross-reference pages, similar to wiki-style linking.

## Usage

### Creating Wiki-Links

To create a link to another page in your book, simply type:

```
[[Page Title]]
```

As you type the closing `]]`, the text will automatically be converted to a clickable wiki-link.

### Example

```
Check out the [[Introduction]] for more information.
You can also read about [[Advanced Features]] in this book.
```

These will render as clickable links that navigate to the pages titled "Introduction" and "Advanced Features" respectively.

## How It Works

### 1. Unique Page Titles

For wiki-links to work correctly, **page titles must be unique within a book**. The system enforces this with a database constraint.

When you create or edit a page, the title is automatically extracted from the first heading (H1-H6) in the page content. If no heading is found, it uses the first 50 characters of text content.

### 2. Link Rendering

Wiki-links are rendered with:
- Blue text color (responsive to dark/light mode)
- Dotted underline
- Cursor pointer on hover
- Hover effect that slightly changes the color

### 3. Navigation

When you click a wiki-link:
1. The system looks up the page by title in the current book
2. If found, it navigates to that page
3. If not found, it shows an error toast message

The lookup is case-insensitive, so `[[Introduction]]` and `[[introduction]]` will match the same page.

## Technical Implementation

### Database Schema

**Unique Constraint**: Pages have a unique constraint on `(book_id, title)` for non-archived pages with non-empty titles.

```sql
CREATE UNIQUE INDEX "unique_book_page_title"
ON "public"."pages"
USING "btree" ("book_id", "title")
WHERE ("archived" = false AND "title" IS NOT NULL AND "title" != '');
```

### TipTap Extension

The wiki-link feature is implemented as a custom TipTap mark extension (`WikiLink`) that:
- Automatically detects and converts `[[text]]` patterns
- Handles click events to navigate to the target page
- Provides proper styling and accessibility

### Components Involved

1. **WikiLink Extension** (`src/components/editor/extensions/WikiLink.ts`)
   - Custom TipTap mark for wiki-links
   - Handles text input parsing and click events

2. **Wiki-Link Navigation Utility** (`src/utils/wikiLinkNavigation.ts`)
   - Looks up pages by title
   - Handles navigation and error cases
   - Provides toast notifications for errors

3. **Editor Configuration** (`src/components/editor/config/editorConfig.ts`)
   - Includes WikiLink extension in the editor
   - Passes navigation handlers to the extension

4. **Page View** (`src/pages/PageView.tsx`)
   - Creates the wiki-link navigation handler
   - Wires up the navigation logic with React Router

## Styling

Wiki-links use Tailwind CSS classes:

```typescript
'wiki-link cursor-pointer text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted'
```

This provides:
- Responsive color scheme (light/dark mode)
- Dotted underline for visual distinction from regular links
- Hover effects for better UX

## Migration

To enable wiki-links in your existing database, run the migration:

```bash
# Apply the migration to add unique constraint
supabase migration up migrations/add_unique_page_title_constraint.sql
```

Or in production:
```sql
-- Add unique constraint for page titles within a book
CREATE UNIQUE INDEX IF NOT EXISTS "unique_book_page_title"
ON "public"."pages"
USING "btree" ("book_id", "title")
WHERE ("archived" = false AND "title" IS NOT NULL AND "title" != '');
```

## Best Practices

1. **Use Descriptive Page Titles**: Since wiki-links rely on page titles, use clear and unique titles for your pages.

2. **Verify Link Targets**: Before publishing, check that all wiki-links point to existing pages by clicking them in edit mode.

3. **Handle Title Changes**: If you change a page title, be aware that existing wiki-links to that page will break. You'll need to update the wiki-links manually.

4. **Avoid Circular Links**: While not technically problematic, circular wiki-links (A → B → A) can confuse readers.

## Error Handling

If a wiki-link points to a non-existent page:
- A toast notification appears: "Page not found: [page title]"
- The link remains visible and clickable (in case the page is created later)
- No navigation occurs

## Future Enhancements

Potential improvements for the wiki-link feature:

1. **Auto-complete**: Suggest page titles as you type `[[`
2. **Backlinks**: Show which pages link to the current page
3. **Broken Link Detection**: Highlight wiki-links that point to non-existent pages
4. **Alias Support**: Allow `[[Page Title|Display Text]]` syntax
5. **Smart Rename**: Automatically update wiki-links when a page title changes
6. **Link Preview**: Show a tooltip preview of the linked page on hover

## Troubleshooting

### Wiki-links aren't working

1. Check that the unique constraint migration has been applied
2. Verify that page titles are unique within the book
3. Ensure you're using the exact page title (case doesn't matter, but spelling does)

### "Page not found" errors

1. Check the spelling of the page title in the wiki-link
2. Verify the target page exists and isn't archived
3. Ensure the target page has a non-empty title

### Database constraint errors when saving pages

If you get a unique constraint violation:
1. Another page in the book already has that title
2. Choose a different title or rename the other page first
3. Check for pages with very similar titles (e.g., "Introduction" vs "Introduction ")

## API Reference

### `WikiLink` TipTap Extension

```typescript
WikiLink.configure({
  onNavigate: (pageTitle: string, bookId: number) => void,
  bookId: number,
})
```

### `createWikiLinkNavigationHandler` Utility

```typescript
function createWikiLinkNavigationHandler(
  bookId: number,
  navigate: (pageId: string) => void,
  showToast: (options: ToastOptions) => void
): (pageTitle: string, bookId: number) => void
```

### `navigateToPageByTitle` Function

```typescript
async function navigateToPageByTitle(
  pageTitle: string,
  options: WikiLinkNavigationOptions
): Promise<void>

interface WikiLinkNavigationOptions {
  bookId: number;
  onNavigate: (pageId: string) => void;
  onError?: (message: string) => void;
}
```
