# Pensive Books - Application Pages

This document provides a comprehensive overview of all pages/routes in the Pensive Books application.

## Table of Contents
- [Public Pages](#public-pages)
- [Private Pages](#private-pages)
- [Route Parameters](#route-parameters)
- [Access Control](#access-control)

---

## Public Pages
These pages are accessible without authentication.

### 1. Landing Page
- **Route:** `/`
- **Component:** `Landing.tsx`
- **Description:** Homepage and landing page for the application
- **Features:**
  - Product overview
  - Call-to-action for signup
  - Feature highlights

### 2. Authentication
- **Routes:** `/auth`, `/auth/callback`
- **Component:** `Auth.tsx`
- **Description:** Login and signup page
- **Features:**
  - Email/password authentication
  - OAuth providers (if configured)
  - Callback handling for auth providers
  - Supabase Auth integration

### 3. Library
- **Route:** `/library`
- **Component:** `Library.tsx`
- **Description:** Public library view of all public books
- **Features:**
  - Browse publicly shared books
  - Search and filter capabilities
  - Book preview cards

### 4. Accept Invitation
- **Route:** `/accept-invitation`
- **Component:** `AcceptInvitation.tsx`
- **Description:** Accept collaboration invitations to books
- **Features:**
  - Token-based invitation acceptance
  - Email verification
  - Redirects to book after acceptance

### 5. Join Book
- **Route:** `/book/:bookId/join/:token`
- **Component:** `JoinBook.tsx`
- **Description:** Join a specific book via invitation link
- **Parameters:**
  - `bookId` - The book's unique identifier
  - `token` - Invitation token for access
- **Features:**
  - Direct book access via token
  - Automatic access granting
  - View or edit permissions based on token

### 6. User Profile
- **Route:** `/:username`
- **Component:** `UserProfile.tsx`
- **Description:** Public user profile/publishing page
- **Parameters:**
  - `username` - The user's unique username
- **Features:**
  - Display profile picture and introduction
  - User's published books
  - Edit profile button (only visible to profile owner)
  - Professional publishing presence

### 7. Privacy Policy
- **Route:** `/privacy`
- **Component:** `PrivacyPolicy.tsx`
- **Description:** Privacy policy page
- **Features:**
  - Legal privacy information
  - Data handling policies

### 8. Terms of Service
- **Route:** `/terms`
- **Component:** `Terms.tsx`
- **Description:** Terms of service page
- **Features:**
  - User agreement
  - Service terms and conditions

### 9. Contact
- **Route:** `/contact`
- **Component:** `Contact.tsx`
- **Description:** Contact page
- **Features:**
  - Contact form
  - Support information
  - Feedback submission

---

## Private Pages
These pages require user authentication. They are wrapped with the `PrivateRoute` component which redirects unauthenticated users to the auth page.

### 10. My Books
- **Route:** `/my-books`
- **Component:** `MyBooks.tsx`
- **Description:** User's personal book collection dashboard
- **Features:**
  - List of owned books
  - List of shared books (view/edit access)
  - Create new book button
  - Archive/unarchive books
  - Pin important books
  - Search and filter books
  - Recent activity

### 11. New Book
- **Route:** `/book/new`
- **Component:** `NewBook.tsx`
- **Description:** Create a new book
- **Features:**
  - Book creation form
  - Set book title, subtitle, author
  - Upload or select cover image
  - Set initial visibility (public/private)

### 12. Book Details
- **Route:** `/book/:id`
- **Component:** `BookDetails.tsx`
- **Parameters:**
  - `id` - The book's unique identifier
- **Description:** Book overview and table of contents
- **Features:**
  - Book metadata display
  - Table of contents navigation
  - Page list management
  - Add/remove pages
  - Reorder pages (drag-and-drop)
  - Share book
  - Send to Kindle
  - Edit book metadata
  - Manage collaborators
  - Archive/delete book
  - View book statistics

### 13. Book Edit
- **Route:** `/book/:id/edit`
- **Component:** `BookEdit.tsx`
- **Parameters:**
  - `id` - The book's unique identifier
- **Description:** Edit book metadata and settings
- **Features:**
  - Edit title, subtitle, author
  - Change cover image
  - Toggle public/private visibility
  - Cover display settings
  - Book archival

### 14. Book Flashcards
- **Route:** `/book/:id/flashcards`
- **Component:** `BookFlashcards.tsx`
- **Parameters:**
  - `id` - The book's unique identifier
- **Description:** Flashcard view for studying book content
- **Features:**
  - Generate flashcards from book content
  - Study mode
  - Progress tracking
  - Spaced repetition

### 15. Page View
- **Route:** `/book/:bookId/page/:pageId`
- **Component:** `PageView.tsx`
- **Parameters:**
  - `bookId` - The book's unique identifier
  - `pageId` - The page's unique identifier
- **Description:** View and edit individual book pages
- **Features:**
  - Rich text editor (TipTap)
  - Auto-save functionality
  - Page navigation (previous/next)
  - Page history access
  - Content formatting toolbar
  - Image uploads
  - Code blocks with syntax highlighting
  - Tables support
  - Page preloading for smooth navigation

### 16. Page History
- **Route:** `/book/:bookId/page/:pageId/history`
- **Component:** `PageHistoryView.tsx`
- **Parameters:**
  - `bookId` - The book's unique identifier
  - `pageId` - The page's unique identifier
- **Description:** View version history for a page
- **Features:**
  - Timeline of page changes
  - View previous versions
  - Compare versions
  - Restore previous version
  - See who made changes

### 17. Generate Book
- **Route:** `/generate-book`
- **Component:** `GenerateBook.tsx`
- **Description:** AI-powered book generation
- **Features:**
  - Topic/prompt input
  - AI-generated table of contents
  - AI-generated content for pages
  - Customization options
  - Progress tracking
  - Preview before creation

### 18. Kindle Settings
- **Route:** `/settings/kindle`
- **Component:** `KindleSettings.tsx`
- **Description:** Configure Kindle integration
- **Features:**
  - Set Kindle email address
  - Email verification with OTP
  - Test Kindle delivery
  - Manage Kindle preferences

### 19. Set Username
- **Route:** `/set-username`
- **Component:** `SetUsername.tsx`
- **Description:** Set or update user's username
- **Features:**
  - Username validation
  - Uniqueness checking
  - Profile setup
  - First-time user onboarding

### 20. Profile Edit
- **Route:** `/profile/edit`
- **Component:** `ProfileEdit.tsx`
- **Description:** Edit user profile information
- **Features:**
  - Upload profile picture
  - Edit introduction/bio (500 characters max)
  - Preview profile changes
  - Image upload with compression
  - Profile picture management

---

## Route Parameters

### Dynamic Segments
- **`:username`** - User's unique username (alphanumeric, lowercase)
- **`:id` / `:bookId`** - Book UUID from database
- **`:pageId`** - Page UUID from database
- **`:token`** - Invitation token (alphanumeric string)

### Query Parameters
Various pages may accept query parameters:
- `?redirect=<path>` - Post-authentication redirect
- `?token=<string>` - Invitation or verification token
- `?search=<query>` - Search queries

---

## Access Control

### Public Access
- No authentication required
- Accessible to all visitors
- 9 public pages total

### Private Access
- Requires user authentication via Supabase Auth
- Uses `PrivateRoute` wrapper component
- Redirects to `/auth` if not authenticated
- 10 private pages total

### Book-Level Access
Book and page routes have additional access control via Row-Level Security (RLS):

**View Access:** User can view a book if:
- They own the book (`owner_id = auth.uid()`)
- The book is public (`is_public = true`)
- They have been granted view/edit access via `book_access` table

**Edit Access:** User can edit a book if:
- They own the book
- They have been granted edit access via `book_access` table

### Page-Level Access
Inherits permissions from parent book:
- View: Same as book view access
- Edit: Same as book edit access

---

## Navigation Flow

### First-Time User
1. `/` (Landing) → `/auth` (Signup)
2. `/set-username` (Set username)
3. `/my-books` (Dashboard)
4. `/book/new` or `/generate-book` (Create first book)

### Returning User
1. `/` (Landing) or `/auth` (Login)
2. `/my-books` (Dashboard)
3. `/book/:id` (Select book)
4. `/book/:bookId/page/:pageId` (Read/edit pages)

### Collaboration Flow
1. Receive email invitation
2. `/accept-invitation?token=...` or `/book/:bookId/join/:token`
3. Grant access
4. `/book/:id` (View shared book)

### Reading Flow
1. `/library` (Browse public books)
2. `/book/:id` (Select book)
3. `/book/:bookId/page/:pageId` (Read pages)
4. Navigate with previous/next buttons

---

## Page Statistics

| Category | Count |
|----------|-------|
| Public Pages | 9 |
| Private Pages | 11 |
| Total Pages | 20 |
| Book Management | 6 |
| Page Management | 2 |
| Settings | 2 |
| Authentication | 1 |
| Legal/Info | 3 |
| Discovery | 2 |
| User Profile | 3 |

---

## Related Documentation

- See `CLAUDE.md` for comprehensive codebase documentation
- See `README.md` for setup and installation instructions
- See `src/components/PrivateRoute.tsx` for authentication logic
- See `src/App.tsx` for routing configuration

---

**Last Updated:** October 2025
