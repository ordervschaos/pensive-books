# Uncommitted Changes Diff Viewer Implementation

## Overview

This document describes the implementation of a git-like diff viewer for the uncommitted changes feature in Pensive Books. The feature allows users to see a visual comparison between the last committed version and the current workspace version of pages.

## Features Implemented

### 1. File Status Badges
Each modified page now displays a status badge indicating whether it was:
- **Modified (M)**: Page exists in both versions with changes
- **Added (A)**: Page is new and doesn't exist in the last commit
- **Deleted (D)**: Page existed in the last commit but has been removed

### 2. Visual Diff Viewer
When clicking on any file in the uncommitted changes list, users can see:
- Side-by-side comparison (Split View)
- Unified diff view (Unified View)
- Line-by-line highlighting of changes
- Word-level diff highlighting for precise change detection
- Statistics showing lines added/removed

### 3. Git-like Display
The interface mimics familiar git diff patterns:
- Color-coded status badges (green for added, orange for modified, red for deleted)
- Status icons for quick visual identification
- "View diff" button (eye icon) to see changes
- "Open page" button to view the full page
- "Revert" button to discard changes

## Technical Implementation

### New Files Created

#### 1. `src/services/DiffService.ts`
Service for handling page diff operations:
- `getPageStatus()`: Determines if a page is added, modified, or deleted
- `getPageDiff()`: Fetches and compares page content between versions
- `getAllPageDiffs()`: Gets diffs for all modified pages in a book
- `contentToText()`: Converts TipTap JSON to plain text for comparison

```typescript
export type FileStatus = "modified" | "added" | "deleted";

export interface PageDiff {
  pageId: number;
  title: string;
  pageIndex: number;
  status: FileStatus;
  oldContent: string;
  newContent: string;
  lastModified: string;
  slug: string;
}
```

#### 2. `src/components/book/PageDiffViewer.tsx`
React component for displaying diffs:
- Uses `react-diff-viewer-continued` library for text diff rendering
- **Two diff modes**:
  - **Blocks mode** (default): Uses BlockDiffViewer for TipTap content comparison
  - **Text mode**: Traditional line-by-line diff with split/unified views
- Supports split view and unified view modes (text mode only)
- Shows statistics (line counts, differences, block changes)
- Displays file status badges and icons
- **Supports two display modes**:
  - **Compact mode** (`compact={true}`): Streamlined inline display
    - No card wrapper or header
    - Smaller tabs and controls
    - Toggle between Blocks/Text views
    - Condensed statistics
  - **Full mode** (`compact={false}`): Standalone display with card wrapper

#### 3. `src/components/book/BlockDiffViewer.tsx`
New component for block-level diff display:
- Displays TipTap blocks with visual cards
- Color-coded by change type (green/red/orange)
- Shows block type labels (Heading, Paragraph, etc.)
- Before/After content display for modified blocks
- Summary statistics (total, added, removed, modified)
- Compact and clean design for inline viewing

### Modified Files

#### `src/pages/books/show/components/UncommittedChangesPanel.tsx`
Enhanced to support inline diff viewing:
- **Replaced modal diff viewer with inline expand/collapse**
- Added state `expandedDiffs` to track which files are expanded
- Added `toggleDiff()` function to expand/collapse individual files
- Added query to fetch page statuses for all modified pages
- Added helper functions for status icons and badges
- Updated UI to show status badges next to each file
- **Made file rows clickable** to expand/collapse diffs
- **Added chevron icons** (ChevronRight/ChevronDown) to indicate expand state
- Integrated PageDiffViewer component in **compact mode**
- Checkbox click events stop propagation to prevent toggling diff

## Dependencies Added

```bash
npm install react-diff-viewer-continued
```

This library provides:
- Side-by-side and unified diff views
- Word-level and line-level highlighting
- Syntax highlighting support
- Customizable themes
- React 18 compatibility
- **Block-by-block display** with `showDiffOnly={true}` option
- Configurable context lines around changes via `extraLinesSurroundingDiff`

## User Flow

1. User navigates to Book Details page
2. Opens the "Uncommitted Changes" tab in the sidebar
3. Sees a list of modified files with status badges (M/A/D)
4. **Clicks on any file row** to expand/collapse the inline diff view
5. Views side-by-side comparison inline or switches to unified view
6. **Clicks again to collapse** the diff and return to compact view
7. Can click "Revert" to discard changes or "Open page" to edit

### Inline Diff Display (VSCode-style)

The diff viewer is now **integrated inline** with each file item, similar to VSCode's git diff view:

- **Click file row to expand**: Shows diff immediately below the file
- **Chevron indicators**: `>` when collapsed, `v` when expanded
- **Collapsible sections**: Each file can be independently expanded/collapsed
- **Compact view**: Minimal UI in expanded state to maximize diff visibility
- **No separate modal**: Everything happens inline in the list

### Block-by-Block Comparison (TipTap Content)

The diff viewer intelligently compares **TipTap JSON content at the block level**:

- **Block-level granularity**: Compares individual blocks (paragraphs, headings, lists, etc.)
- **Three change types**:
  - **Added blocks** (green): New blocks that don't exist in committed version
  - **Removed blocks** (red): Blocks that existed in committed version but were deleted
  - **Modified blocks** (orange): Blocks that exist in both versions but have changed content
- **Skip unchanged blocks**: Only shows blocks that have actual changes
- **Two view modes**:
  - **Blocks view** (default): Shows block-by-block comparison with block type labels
  - **Text view**: Traditional line-by-line text diff (fallback)
- **Context preservation**: Each block shows before/after state for modified content
- **Smart matching algorithm**:
  - **Position-based matching**: First checks if blocks at the same position are equal or modified
  - **Attribute matching**: Uses `audioBlock` attribute to track blocks across versions
  - **Content similarity**: Matches blocks with identical type and content
  - **Handles reordering**: Finds moved blocks by comparing attributes and content
  - **Three-pass algorithm**:
    1. Match blocks at same positions
    2. Find added blocks with fuzzy matching
    3. Identify removed blocks
- **TipTap-aware**: Understands document structure with proper JSON parsing
  - Handles both `{type: "doc", content: [...]}` and direct array formats
  - Extracts block attributes (level for headings, audioBlock, etc.)
  - Recursively processes nested content

## Data Flow

```
UncommittedChangesPanel
  ↓ (fetches modified page IDs)
VersionService.getModifiedPageIds()
  ↓ (for each page)
DiffService.getPageStatus()
  ↓ (determines: added/modified/deleted)
PageDiffViewer
  ↓ (on click)
DiffService.getPageDiff()
  ↓ (compares versions)
ReactDiffViewer (renders)
```

## Styling

The diff viewer uses color coding:
- **Green background**: Added content
- **Red background**: Removed content
- **Green highlight**: Added words
- **Red highlight**: Removed words
- **Status badges**:
  - Green border/background for "Added"
  - Orange border/background for "Modified"
  - Red border/background for "Deleted"
- **Context lines**: Unchanged lines shown with 3 lines before/after each change
- **Change blocks**: Separated visually to distinguish multiple changed sections

## File Status Detection Logic

The `DiffService.getPageStatus()` method determines status by:

1. **Added**: Page exists in current workspace but not in last commit
   - No previous version found
   - Current page exists

2. **Deleted**: Page existed in last commit but not in current workspace
   - Previous version found
   - Current page doesn't exist or is archived

3. **Modified**: Page exists in both versions with changes
   - Previous version found
   - Current page exists
   - Content differs between versions

## Performance Considerations

- Page statuses are fetched in parallel for all modified pages
- React Query caching prevents redundant API calls
- Diff calculations happen on-demand when viewing a specific page
- Content is converted to plain text for efficient comparison

## Future Enhancements

Potential improvements:
- Inline editing from diff view
- Jump to specific changes
- Export diff as patch file
- Show diffs for deleted pages (from last commit)
- Compare any two versions (not just workspace vs. last commit)
- Syntax highlighting for code blocks in diffs
- Filtering by file status (show only added/modified/deleted)
- Bulk operations (revert all added, revert all modified, etc.)

## Related Components

- `VersionService`: Manages version control operations
- `CommitDialog`: Creates new commits
- `VersionHistory`: Shows commit history
- `BookSidebar`: Container for uncommitted changes panel

## Testing

To test the feature:

1. **Modified Pages**: Edit a page's content after committing
2. **Added Pages**: Create a new page after committing
3. **Deleted Pages**: Archive a page after committing (note: current implementation focuses on modified and added)

The diff viewer should correctly identify the status and show appropriate differences.

## API Integration

The feature integrates with existing Supabase tables:
- `books`: Book metadata
- `pages`: Current page content
- `book_versions`: Committed book versions
- `page_versions`: Committed page snapshots

## UI Components Used

From shadcn/ui:
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`
- `Button`
- `Badge`
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`
- `ScrollArea`
- `Checkbox`

Icons from lucide-react:
- `FileEdit`, `FilePlus`, `FileX` (status icons)
- `ChevronRight`, `ChevronDown` (expand/collapse indicators)
- `ExternalLink` (open page)
- `RotateCcw` (revert)
- `X` (close - full mode only)

## Responsive Design

The UI has been optimized for various screen sizes:

### File List Items (UncommittedChangesPanel)
- **Layout**: Two-row structure for better space utilization
  - **Top row**: Checkbox + Status badge + Title + Page number
  - **Bottom row**: Timestamp + Action buttons
- **Text handling**: Title uses `break-words` to wrap long titles properly
- **Action buttons**: Reduced size (7x7) with tooltips for clarity
- **Flexible spacing**: Uses `flex-shrink-0` for fixed-width elements and `min-w-0` for flexible content

### Action Buttons
- **Mobile**: Stacks vertically with shorter text ("Selected" instead of "Revert Selected")
- **Desktop**: Displays horizontally with full text
- **Responsive text**: Uses Tailwind's `sm:hidden` and `hidden sm:inline` patterns

### Diff Viewer (PageDiffViewer)
- **Header**: Stacks vertically on small screens, horizontal on larger screens
- **Title**: Uses `break-words` to handle long page titles
- **View mode tabs**: Full width on mobile, auto width on desktop
- **Tab labels**: Shortened on mobile ("Split" vs "Split View")
- **Statistics**: Stacks vertically on mobile for better readability
- **Diff content**: Horizontal scroll enabled for wide diffs
- **Label compression**: "Lines before/after" shortened to "Before/After" on mobile

### Breakpoints
Uses Tailwind's `sm:` breakpoint (640px) for responsive transitions:
```css
sm:flex-row    /* Horizontal layout on desktop */
sm:inline      /* Show full text on desktop */
sm:hidden      /* Hide on desktop */
hidden sm:inline  /* Hide on mobile, show on desktop */
```

---

**Implementation Date**: November 2025
**Last Updated**: November 2025 (Responsive improvements added)
