# 🔗 Page Linking Feature

## Overview

Internal page linking system that allows you to create wiki-style links between pages in your books using `[[page name]]` syntax. Features include autocomplete search, quick page creation, and smart bracket handling.

---

## 🚀 Quick Start

### Link to Existing Page
1. Type `[[`
2. Start typing to search pages
3. Select from dropdown or press Enter
4. Link appears as a pill: <kbd>page name</kbd>

### Create New Page + Link
1. Type `[[new page name`
2. Press **Alt+Enter** (⌥↵ on Mac)
3. Page is created and you're taken there immediately

### Close Dropdown Without Linking
1. Type `[[some text`
2. Type `]]` to close dropdown
3. Text remains as plain text: `[[some text]]`

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `[[` | Open page selector |
| `]]` | Close dropdown (keep as plain text) |
| Type text | Filter/search pages |
| `↑` / `↓` | Navigate suggestions |
| `Enter` | Select highlighted suggestion |
| `Alt+Enter` / `⌥↵` | Create new page with typed name + navigate |
| `Esc` | Cancel/close dropdown |

---

## ✨ Key Features

### 1. Autocomplete Search
- Type `[[` to see all pages in current book
- Instant filtering as you type
- Shows up to 10 matching results
- Case-insensitive search

### 2. Smart Disambiguation
When multiple pages have the same title:
```
Introduction (Page 1)
Introduction (Page 5)
Introduction (Page 12)
```
Each shows its page number for clarity.

### 3. Quick Page Creation
- Type `[[new concept]]` + Alt+Enter
- Creates "new concept" page at end of book
- Inserts link automatically
- **Navigates you to the new page** to start editing
- Allows duplicate titles (they'll be disambiguated)

### 4. Smart Bracket Handling
- `[[page ti|tle]]` - Cursor anywhere = captures "page title"
- `[[text]]|` - Cursor after = still captures "text"
- `[[some]|]` - Between brackets = closes dropdown
- `[[text` - No closing = works normally

### 5. Pill-Style Links
Links appear as rounded pills with:
- Light colored background (10% opacity)
- No underline (unlike regular links)
- Hover effect (darker background)
- Click to navigate

### 6. Broken Link Detection
If target page is deleted:
- Link shows with strikethrough
- Red/destructive color scheme
- Tooltip: "This page no longer exists"
- Click does nothing

---

## 🎨 Visual Design

### Active Links
```
Style: Rounded pill with light blue background
Color: Primary theme color
Hover: Slightly darker background
```

### Broken Links
```
Style: Rounded pill with light red background
Color: Muted red/destructive color
Effect: Strikethrough text
```

### Example
Normal text with a <kbd>linked page</kbd> in the middle.

---

## 🔍 How It Works

### Storage Format
Links stored in TipTap JSON format:
```json
{
  "type": "text",
  "text": "Introduction",
  "marks": [{
    "type": "pageLink",
    "attrs": {
      "pageId": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Introduction",
      "bookId": "123",
      "broken": false
    }
  }]
}
```

### Database Schema
```sql
-- Pages table
pages (
  id uuid PRIMARY KEY,
  book_id integer,
  title text,           -- NOT unique (duplicates allowed)
  page_index integer,   -- Used for disambiguation
  archived boolean,
  ...
)
```

### Key Insight
- **Store by ID** (immutable, never breaks)
- **Display by title** (human-readable)
- **Disambiguate by index** (when needed)
- No unique constraint on titles needed!

---

## 💡 Common Use Cases

### 1. Building a Knowledge Base
```
[[Concepts]]
[[Implementation Details]]
[[Common Patterns]]
[[Troubleshooting]]
```
Quickly create structure, fill in later.

### 2. Creating Study Guides
```
Chapter 1: [[Introduction]]
See also: [[Key Terms]] and [[Practice Problems]]
Review [[Summary Notes]] before exam.
```

### 3. Project Planning
```
Project: [[Website Redesign]]
Tasks: [[Design Mockups]], [[User Research]]
Timeline: [[Q1 Goals]]
```
Alt+Enter each one to create pages instantly.

### 4. Cross-Referencing
```
For more details, see [[Advanced Topics]].
This relates to [[Chapter 3]] and [[Appendix A]].
```

---

## 🧪 Testing Checklist

### Basic Functionality
- [ ] `[[` opens dropdown with all pages
- [ ] Typing filters pages by title
- [ ] Arrow keys navigate suggestions
- [ ] Enter selects and inserts link
- [ ] Link appears as pill with background
- [ ] Click link navigates to page

### Creating New Pages
- [ ] Alt+Enter creates new page
- [ ] Link is inserted in original page
- [ ] Navigated to new page immediately
- [ ] New page appears at end of book
- [ ] Can create duplicate titled pages

### Smart Brackets
- [ ] `]]` closes dropdown
- [ ] Text remains: `[[text]]`
- [ ] Cursor in middle captures full text
- [ ] Cursor after `]]` closes dropdown

### Edge Cases
- [ ] Empty book still allows creation
- [ ] Duplicate titles show disambiguation
- [ ] Archived pages excluded from search
- [ ] Many pages (100+) performs well
- [ ] Mobile/touch works correctly

### After Link Insertion
- [ ] Space added after link automatically
- [ ] Pressing Enter creates normal paragraph (not H1)
- [ ] Can continue typing normally
- [ ] Can edit link by clicking on it

---

## 🐛 Troubleshooting

### Dropdown Doesn't Appear
- Ensure you're in edit mode
- Type exactly `[[` (two opening brackets)
- Check browser console for errors

### Wrong Query Captured
- Issue: `[[text]]` shows `text]` in dropdown
- Fixed: Cursor detection between `]]` now works
- Try typing `]]` to close if stuck

### Link Doesn't Navigate
- Check you're in view mode (not edit mode)
- Verify page still exists (not deleted)
- Check browser console for navigation errors

### Created Page Missing
- Check end of page list (sorts by page_index)
- Look for "Untitled" if no title was provided
- Verify in database: `pages` table

### H1 After Link
- Fixed: Space automatically added after link
- If still occurring, reload page
- Check TipTap version compatibility

---

## 🔧 Technical Details

### Components

**PageLink Extension**
- `src/components/editor/extensions/PageLink.ts`
- Custom TipTap Mark extension
- Handles rendering, clicking, broken links

**PageLinkSuggestion Extension**
- `src/components/editor/extensions/PageLinkSuggestion.tsx`
- Uses TipTap Suggestion utility + Tippy.js
- Handles `[[` trigger, dropdown, page creation
- Smart bracket detection

**Integration**
- `src/components/editor/config/editorConfig.ts` - Configuration
- `src/components/editor/TipTapEditor.tsx` - Navigation handling
- `src/components/page/PageContent.tsx` - Pass bookId prop

### Dependencies
```json
{
  "@tiptap/suggestion": "^3.4.2",
  "tippy.js": "^6.3.7"
}
```

### Database Functions Used
- `create_next_page(p_book_id)` - Creates page at end of book
- Returns table with full page data (id, title, page_index, etc.)

---

## 🚀 Future Enhancements

### Planned Features
- [ ] **Backlinks** - Show pages that link to current page
- [ ] **Link Preview** - Hover to see page content preview
- [ ] **Broken Link Report** - Find all broken links in book
- [ ] **Cross-Book Links** - Link to pages in other books
- [ ] **Anchor Links** - Link to specific sections: `[[Page#Section]]`
- [ ] **Link Analytics** - Most linked pages, orphaned pages

### Nice to Have
- [ ] **Link Graph View** - Visual network of page connections
- [ ] **Smart Suggestions** - Suggest related pages while typing
- [ ] **Recent Pages** - Show recently edited pages first
- [ ] **Templates** - `[[New Page|template]]` creates from template
- [ ] **Aliases** - Multiple names for same page

---

## 📚 Resources

### Documentation
- TipTap Marks: https://tiptap.dev/docs/editor/extensions/marks
- TipTap Suggestion: https://tiptap.dev/docs/editor/api/utilities/suggestion
- Tippy.js: https://atomiks.github.io/tippyjs/

### Implementation Files
- Main feature: `src/components/editor/extensions/PageLink*.ts(x)`
- Documentation: `page-linking-feature.md` (detailed technical)
- Testing guide: `TESTING-PAGE-LINKS.md`

---

## 🎉 Summary

You now have a powerful wiki-style linking system that:

✅ Makes connecting pages effortless with `[[` syntax
✅ Creates new pages on-the-fly with Alt+Enter
✅ Handles duplicate titles gracefully
✅ Provides instant search and navigation
✅ Looks great with pill-style links
✅ Stores links by immutable IDs (never breaks)

**Happy linking! 🔗**

---

*Last updated: November 2024*
