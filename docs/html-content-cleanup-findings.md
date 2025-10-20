# HTML Content Field Cleanup - Findings Report

**Date**: October 20, 2025
**Status**: Complete

## Summary

The `html_content` field has been deprecated in favor of the `content` JSON field which stores TipTap editor content. This document summarizes the cleanup effort to remove outdated references and avoid confusion.

## Background

The application previously used `html_content` to store page content as HTML strings. The system has migrated to using a structured JSON format (`content` field) which provides:
- Better structure for parsing and manipulation
- Support for block-based audio generation
- Easier content transformation
- Type safety with TipTap's JSON schema

## Changes Made

### 1. Documentation Updates

#### `/docs/html-to-tts-processing.md`
- **Removed**: Outdated section about migration from `page.content` with fallback to `html_content`
- **Added**: Current implementation details explaining that content is processed from the TipTap JSON structure
- **Status**: ✅ Updated

#### `/docs/block-based-audio-highlighting.md`
- **Updated**: Content storage section to remove mention of dual HTML/JSON storage
- **Updated**: Hook documentation to remove HTML content parameter
- **Updated**: Migration notes to reflect current state
- **Status**: ✅ Updated

### 2. Code Cleanup

#### `/scripts/migrate-html-to-content.ts`
- **Action**: Removed entire file
- **Reason**: Migration from `html_content` to `content` JSON is complete
- **Status**: ✅ Deleted

### 3. Test Files

Added backward compatibility notes to test files that reference `html_content`:

#### `/src/utils/tiptapHelpers.test.ts`
- **Action**: Added comment explaining that `html_content` references are for backward compatibility testing only
- **Status**: ✅ Documented

#### `/src/__tests__/json-content-integration.test.ts`
- **Action**: Added header comment explaining deprecated field usage in tests
- **Status**: ✅ Documented

#### `/src/pages/PageHistoryView.test.tsx`
- **Action**: Added header comment explaining deprecated field usage in tests
- **Status**: ✅ Documented

### 4. Database Schema

The following files still contain `html_content` references and **should be kept** for backward compatibility:

#### `/src/integrations/supabase/types.ts` (Lines 234, 243, 252, 280, 297, 314, 651, 679, 695)
- **Status**: ⚠️ Keep - Auto-generated from database schema
- **Reason**: Database still has the field for legacy data and backward compatibility

#### `/schema.sql` (Multiple lines)
- **Status**: ⚠️ Keep - Database schema file
- **Reason**: Field exists in database for:
  - Backward compatibility with old pages
  - Legacy search functions (`search_book_contents`, `similarity_search`)
  - Legacy triggers (`update_title_from_content`)
- **Note**: These database functions may need future updates to use `content` field instead

## Remaining `html_content` References

### Files That Should Keep References

| File | Lines | Reason | Action |
|------|-------|--------|--------|
| `src/integrations/supabase/types.ts` | Multiple | Auto-generated from DB | Keep |
| `schema.sql` | Multiple | Database schema definition | Keep |
| `src/utils/tiptapHelpers.test.ts` | 451-459, 463, 475, 481, 493 | Backward compatibility tests | Keep (documented) |
| `src/__tests__/json-content-integration.test.ts` | Multiple | Integration tests | Keep (documented) |
| `src/pages/PageHistoryView.test.tsx` | 28, 38 | Component tests | Keep (documented) |

### Database Functions Using `html_content`

The following database functions in `schema.sql` still use `html_content`:

1. **`extract_title_from_content()`** (Line 68)
   - Extracts page title from HTML content
   - Used by trigger `update_title_from_content`

2. **`search_book_contents()`** (Lines 145, 153)
   - Full-text search within books
   - Uses `to_tsvector` on HTML content

3. **`highlight_search_results_in_page()`** (Lines 192, 208)
   - Search with result highlighting
   - Uses `to_tsvector` on HTML content

4. **`similarity_search()`** (Line 219, 226)
   - Vector similarity search
   - Returns `html_content` in results

5. **`vector_page_search()`** (Lines 278, 293)
   - Vector-based page search
   - Uses and returns `html_content`

## Recommendations

### Short Term (Done ✅)
- [x] Update documentation to reflect current content architecture
- [x] Remove obsolete migration scripts
- [x] Add comments to test files explaining backward compatibility

### Medium Term (Future Work)
- [ ] Update database search functions to use `content` JSON field instead of `html_content`
- [ ] Update triggers to extract title from JSON content
- [ ] Consider adding a deprecation notice in type definitions

### Long Term (Future Work)
- [ ] Phase out `html_content` field entirely from database (breaking change)
- [ ] Update all database functions to work exclusively with JSON content
- [ ] Remove field from Supabase types after database migration

## Testing Recommendations

When making future changes:
1. Ensure backward compatibility tests still pass
2. Test with pages that have only `content` JSON (new format)
3. Test with pages that have only `html_content` (legacy format)
4. Test with pages that have both (transition state)
5. Verify search functionality works with current architecture

## Conclusion

The cleanup is complete for application code and documentation. The `html_content` field remains in:
- Database schema (for backward compatibility)
- Type definitions (auto-generated from database)
- Test files (documented as backward compatibility tests)

Future work should focus on migrating database functions from `html_content` to `content` JSON field.

---

**Report Generated**: October 20, 2025
**Verified By**: Claude Code
**Next Review**: Consider when planning database schema updates
