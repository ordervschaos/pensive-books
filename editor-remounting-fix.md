# Editor Remounting Issue - Root Cause Analysis

## Problem
The TipTap editor remounts unexpectedly every few minutes, causing the cursor to jump to the beginning of the document while editing.

## Root Causes Identified

### 1. **Duplicate Link Extension** ⚠️
**Location**: `src/components/editor/config/editorConfig.ts:114`

The StarterKit already includes a Link extension by default. Adding another Link extension explicitly causes:
- Console warning: "Link extension is duplicated"
- Potential conflicts in extension registration
- Possible remounting triggers

**Fix**: Disable the Link extension in StarterKit and configure it separately, OR remove the duplicate Link import.

### 2. **Editor Config Recreation on Every Render**
**Location**: `src/components/editor/TipTapEditor.tsx:60-71`

```typescript
const defaultConfig = getEditorConfig(
  content,
  onChange,
  editable,
  isEditing,
  uploadImage,
  bookId,
  handlePageLinkClick
);
const config = editorConfig || defaultConfig;

const editor = useEditor(config);
```

The `getEditorConfig` function is called on every render, creating a new config object each time. This can cause TipTap's `useEditor` hook to detect changes and recreate the editor instance.

**Fix**: Memoize the editor config using `useMemo` with proper dependencies.

### 3. **Content Updates While Editing**
**Location**: `src/components/editor/TipTapEditor.tsx:75-86`

The content update effect runs when `content` prop changes, even in edit mode (with a guard):
```typescript
useEffect(() => {
  if (editor && !isEditing) {
    // Updates content
  }
}, [editor, content, isEditing]);
```

If the parent component re-renders and passes a slightly different content object (same data, different reference), this could trigger issues.

### 4. **React Query Refetching**
**Location**: `src/hooks/use-page-view-data.ts:66-97`

The page data query has:
```typescript
refetchOnMount: false,
refetchOnWindowFocus: false,
refetchOnReconnect: false,
```

However, there's no `refetchInterval` disabled, so React Query might be periodically refetching in the background, causing the page state to update.

## Impact Analysis

The combination of these issues creates a scenario where:
1. Editor config is recreated frequently
2. Link extension conflicts cause instability
3. React Query might trigger background refetches
4. Content updates propagate through the component tree
5. TipTap detects changes and remounts the editor

This explains the "every 3 minutes or so" behavior - likely tied to React Query's default stale time or background refetch intervals.

## Recommended Fixes

### High Priority
1. ✅ Remove duplicate Link extension
2. ✅ Memoize editor config in TipTapEditor
3. ✅ Add explicit `refetchInterval: false` to React Query

### Medium Priority
4. ✅ Add stability to content prop passing (useMemo in parent)
5. ✅ Consider using `key` prop more carefully to control remounting

### Low Priority
6. Review PageContent's content update logic
7. Add debug logging to track remount triggers

## Files to Modify

1. `src/components/editor/config/editorConfig.ts` - Fix duplicate Link extension
2. `src/components/editor/TipTapEditor.tsx` - Memoize config
3. `src/hooks/use-page-view-data.ts` - Disable refetch interval
4. `src/components/page/PageContent.tsx` - Stabilize content prop
