# How Pensive Books Works

## Executive Summary

Pensive Books is a collaborative digital notebook platform that allows users to create, edit, and share books with rich text content. It's built as a modern single-page application (SPA) using React and TypeScript on the frontend, with Supabase providing the backend infrastructure (PostgreSQL database, authentication, storage, and serverless functions).

**Core Flow**: Users authenticate → Create/access books → Edit pages with a rich text editor → Content saves to Supabase → Share with collaborators → Optional: Send to Kindle

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    React Application                        │ │
│  │  (Vite bundled, TypeScript, shadcn/ui components)          │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
                    (REST API / Realtime)
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│                      SUPABASE BACKEND                            │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │ PostgreSQL   │  │   Auth       │  │  Edge Functions    │   │
│  │ + RLS        │  │              │  │  (Serverless)      │   │
│  └──────────────┘  └──────────────┘  └────────────────────┘   │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │   Storage    │  │   Realtime   │                            │
│  │  (Images)    │  │  (Optional)  │                            │
│  └──────────────┘  └──────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
                    (External Services)
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│   THIRD-PARTY SERVICES                                           │
│   • Unsplash (Cover Images)                                      │
│   • Mailgun (Email Invitations)                                  │
│   • OpenAI (AI Book Generation)                                  │
│   • Amazon Kindle (Send to Kindle)                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Application Entry Point & Initialization

### File: `src/main.tsx`

This is where the application starts:

```typescript
createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
```

**What happens**:
1. React creates a root DOM node
2. Wraps the app in `HelmetProvider` for managing document `<head>` (meta tags, titles)
3. Renders the main `App` component

---

## Core Application Structure

### File: `src/App.tsx`

The App component is the orchestrator of the entire application. It sets up:

#### 1. **Global Providers**
```typescript
<QueryClientProvider client={queryClient}>
  <ThemeProvider defaultTheme="light">
    <Router basename={basename}>
      ...
    </Router>
  </ThemeProvider>
</QueryClientProvider>
```

**Providers explained**:
- **QueryClientProvider**: Enables React Query for server state management (caching, refetching)
- **ThemeProvider**: Manages light/dark theme switching
- **Router**: React Router v6 for client-side routing

#### 2. **Navigation Components**
- `<TopNav />`: Top navigation bar (always visible)
- `<Footer />`: Footer component (always visible)
- `<Toaster />`: Toast notification system

#### 3. **Routing System**

Routes are divided into **public** and **private**:

**Public Routes** (no authentication required):
- `/` - Landing page
- `/auth` - Login/signup
- `/library` - Public book library
- `/book/:bookId/join/:token` - Join book via invitation
- `/privacy`, `/terms`, `/contact` - Legal pages

**Private Routes** (authentication required via `<PrivateRoute>` wrapper):
- `/my-books` - User's book collection
- `/book/new` - Create new book
- `/book/:id` - Book details & table of contents
- `/book/:id/edit` - Edit book metadata
- `/book/:bookId/page/:pageId` - View/edit individual page
- `/generate-book` - AI-powered book generation
- `/settings/kindle` - Kindle integration settings

**How Private Routes Work**:
```typescript
<Route path="/my-books" element={
  <PrivateRoute>
    <MyBooks />
  </PrivateRoute>
} />
```

The `PrivateRoute` component checks if the user is authenticated. If not, it redirects to `/auth`.

#### 4. **Scroll & Analytics**
```typescript
function ScrollToTop() {
  const { pathname } = useLocation();
  useGoogleAnalytics();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
```

This ensures:
- Page scrolls to top on route change
- Google Analytics tracks page views

---

## Data Flow Architecture

### 1. Authentication Flow

```
User visits site
    ↓
User clicks "Sign in with Email"
    ↓
Supabase Auth handles email/magic link
    ↓
Supabase returns session with JWT
    ↓
Session stored in browser (localStorage)
    ↓
App detects session → User is authenticated
    ↓
User can access private routes
```

**Implementation**: `src/components/PrivateRoute.tsx`
- Checks `supabase.auth.getSession()`
- If no session → redirect to `/auth`
- If session exists → render protected component

### 2. Book Creation Flow

```
User clicks "New Book"
    ↓
Navigate to /book/new
    ↓
User fills form (title, subtitle, author)
    ↓
Form submits to Supabase
    ↓
INSERT into books table (owner_id = current user)
    ↓
First page automatically created via trigger/function
    ↓
User redirected to /book/:id
```

**Key files**:
- `src/pages/NewBook.tsx` - Form UI
- Supabase function: `create_next_page()` - Creates first page

### 3. Page Editing Flow (Most Important)

This is the heart of Pensive Books. Here's how page editing works:

#### File: `src/pages/PageView.tsx`

**Step-by-step**:

1. **Page Load & Data Fetching**
```typescript
const fetchPageDetails = useCallback(async () => {
  // Fetch page data
  const { data: pageData } = await supabase
    .from("pages")
    .select("*")
    .eq("id", numericPageId)
    .maybeSingle();

  // Fetch book data
  const { data: bookData } = await supabase
    .from("books")
    .select("*")
    .eq("id", numericBookId)
    .maybeSingle();

  // Fetch all pages for navigation
  const { data: pagesData } = await supabase
    .from("pages")
    .select("id, title, page_index")
    .eq("book_id", numericBookId)
    .order("page_index");

  setPage(pageData);
  setBook(bookData);
  setAllPages(pagesData);
}, [numericBookId, numericPageId]);
```

2. **Permission Check**
```typescript
const { canEdit, isOwner } = useBookPermissions(bookId);
```

This hook queries the `book_access` table to determine if the user has edit rights.

3. **Render Editor**
```typescript
<PageContent
  content={page?.content|| ''}
  onSave={handleSave}
  editable={canEdit}
  isEditing={isEditing}
/>
```

4. **Content Saving**
```typescript
const handleSave = async (html: string) => {
  const { error } = await supabase
    .from("pages")
    .update({
      content,
      title: getTitleFromHtml(html),
      updated_at: new Date().toISOString()
    })
    .eq("id", pageId);
};
```

5. **Page Navigation**
- Left/right arrow keys navigate between pages
- `PagePreloader` component preloads adjacent pages for instant navigation
- Bookmarks are saved to track reading position

---

## Rich Text Editor

### File: `src/components/editor/TipTapEditor.tsx`

**How it works**:

1. **TipTap Setup**
```typescript
const editor = useEditor({
  extensions: [
    StarterKit,
    Link,
    Image,
    Table,
    CodeBlockLowlight,
    // ... more extensions
  ],
  content: initialHtmlContent,
  onUpdate: ({ editor }) => {
    onChange(editor.getHTML());
  }
});
```

2. **Toolbar** (`EditorToolbar.tsx`)
- Bold, italic, underline buttons
- Heading buttons (H1, H2, H3)
- List buttons (bullet, numbered)
- Code block, table, link, image buttons
- Each button calls `editor.chain().focus().toggleBold().run()` etc.

3. **Content Format**
- Content is stored as HTML in the database
- TipTap converts HTML ↔ JSON ↔ Editor state
- On save, HTML is extracted via `editor.getHTML()`

4. **Image Upload**
```typescript
const uploadImage = useSupabaseUpload();
// When user uploads image:
// 1. Compress image
// 2. Upload to Supabase Storage
// 3. Get public URL
// 4. Insert into editor as <img src="...">
```

---

## Collaboration & Access Control

### Database: `book_access` table

```sql
book_access
├── book_id
├── user_id
├── invited_email
├── access_level (view | edit)
├── invitation_token
└── status
```

### How Sharing Works:

1. **Book Owner Invites Collaborator**
```typescript
// User clicks "Share" → Opens ShareBookSheet
// Enters email, selects access level (view/edit)
// Creates book_access record with unique token
```

2. **Invitation Email Sent**
```typescript
// Supabase Edge Function: send-book-invitation
// Uses Mailgun to send email with invitation link
// Link format: /book/:bookId/join/:token
```

3. **Collaborator Accepts Invitation**
```typescript
// Collaborator clicks link → navigates to JoinBook page
// Token is validated against book_access table
// If valid, user_id is set in book_access record
// User gains access to book
```

4. **Row-Level Security (RLS) Enforcement**
```sql
-- Users can view books if:
CREATE POLICY "view_books" ON books
FOR SELECT USING (
  owner_id = auth.uid() OR
  is_public = true OR
  EXISTS (
    SELECT 1 FROM book_access
    WHERE book_id = books.id
    AND user_id = auth.uid()
  )
);
```

This ensures:
- Database automatically filters queries based on user permissions
- No way to bypass access control from the frontend
- All queries are secure by default

---

## Performance Optimizations

### 1. Page Preloading

**File**: `src/utils/pagePreloader.ts`

```typescript
export const preloadPages = async (bookId: number, pageIds: number[]) => {
  // Fetch next 3 pages in advance
  // Store in PageCache
  // When user navigates, page loads instantly from cache
};
```

**How it works**:
- When viewing page N, pages N+1, N+2, N+3 are preloaded
- Uses `PageCache` service to store data
- Significantly reduces perceived loading time

### 2. React Query Caching

```typescript
const { data: books } = useQuery({
  queryKey: ['books', userId],
  queryFn: () => fetchBooks(userId),
  staleTime: 5 * 60 * 1000, // Cache for 5 minutes
});
```

**Benefits**:
- Automatic request deduplication
- Background refetching
- Optimistic updates
- Reduced server load

### 3. Image Optimization

```typescript
// Before upload:
const compressed = await imageCompression(file, {
  maxSizeMB: 1,
  maxWidthOrHeight: 1920,
});
// Then upload compressed version
```

---

## AI-Powered Features

### Book Generation

**File**: `src/pages/GenerateBook.tsx`

**Flow**:
1. User enters book topic/description
2. Frontend calls Edge Function: `flesh-out-book`
3. Function uses OpenAI API to generate:
   - Book title
   - Table of contents
   - Chapter/section structure
4. Function calls `generate-book-content` for each section
5. Content is generated and stored in pages table
6. User can edit generated content

**Edge Function**: `supabase/functions/flesh-out-book/`
```typescript
const response = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "system", content: "Generate a book outline..." },
    { role: "user", content: userPrompt }
  ]
});
// Parse response, create book and pages
```

---

## Kindle Integration

### Setup Flow:
1. User goes to `/settings/kindle`
2. Enters Kindle email (e.g., `user@kindle.com`)
3. Edge Function sends verification email with OTP
4. User enters OTP to verify
5. Kindle email is saved in `user_data` table

### Send to Kindle Flow:
1. User clicks "Send to Kindle" on book details page
2. Edge Function: `send-to-kindle` is called
3. Function:
   - Fetches all pages from book
   - Converts HTML to EPUB format
   - Converts EPUB to MOBI using Calibre
   - Sends MOBI file to Kindle email via Mailgun
4. Book appears on user's Kindle device

---

## Database Schema Deep Dive

### `books` Table
```sql
books
├── id (primary key)
├── name (title)
├── subtitle
├── author
├── owner_id (foreign key → auth.users)
├── cover_url
├── is_public (boolean)
├── is_archived (boolean)
├── page_ids (JSON array - page ordering) - deprecated
├── slug (URL-friendly)
└── timestamps (created_at, updated_at, etc.)
```

**Why `page_ids`?** - deprecated
- Allows custom page ordering
- Drag-and-drop reordering updates this array
- Pages can be reordered without changing page_index

### `pages` Table
```sql
pages
├── id (primary key)
├── book_id (foreign key → books)
├── owner_id (foreign key → auth.users)
├── title
├── content (JSON - TipTap format)
├── page_index (order within book)
├── page_type (text | section)
├── embedding (vector - for semantic search)
└── timestamps
```

**Content Storage**:
- `content`: TipTap JSON format (structured)

### `page_history` Table
```sql
page_history
├── id
├── page_id (foreign key → pages)
├── content (snapshot)
├── created_by (user who made change)
├── batch_id (groups related changes)
└── created_at
```

**How History Works**:
- On every page save, a snapshot is created
- Deduplication by minute (avoid spam on autosave)
- Users can view history and compare versions
- Restore from any historical version

---

## Search Functionality

### Full-Text Search
```sql
-- Database function
CREATE FUNCTION search_book_contents(search_query TEXT, book_id INT)
```

**Implementation**:
1. User types query in search dialog
2. Frontend calls `search_book_contents` function
3. PostgreSQL performs full-text search across all pages
4. Results are ranked by relevance
5. Search dialog displays matching pages with highlights

### Semantic Search (Vector Search)
```sql
-- Uses embeddings column in pages table
CREATE FUNCTION vector_page_search(
  query_embedding vector,
  book_id INT
)
```

**How it works**:
1. When page is created/updated, generate embedding via OpenAI
2. Store embedding in `pages.embedding` column
3. On search, convert query to embedding
4. Use cosine similarity to find semantically similar pages
5. Return results ranked by similarity score

---

## State Management Patterns

### Server State (React Query)
```typescript
// Fetching books
const { data, isLoading, error } = useQuery({
  queryKey: ['books', userId],
  queryFn: async () => {
    const { data } = await supabase
      .from('books')
      .select('*')
      .eq('owner_id', userId);
    return data;
  }
});
```

**When to use**: Any data from Supabase

### Local State (useState)
```typescript
const [isEditing, setIsEditing] = useState(false);
const [saving, setSaving] = useState(false);
```

**When to use**: UI state that doesn't need to persist

### URL State (useSearchParams)
```typescript
const [searchParams] = useSearchParams();
const editMode = searchParams.get("edit") === "true";
```

**When to use**: State that should be shareable via URL

---

## Security Model

### 1. Row-Level Security (RLS)
All tables have RLS policies that enforce:
- Users can only see their own books (or public/shared books)
- Users can only edit books they own or have edit access to
- All queries are automatically filtered by Supabase

### 2. Authentication
- Supabase Auth handles all authentication
- JWT tokens are stored in `localStorage`
- Tokens are automatically included in all requests
- Tokens expire after 1 hour, refresh tokens handle renewal

### 3. API Keys
- Frontend only has `VITE_SUPABASE_ANON_KEY` (public, safe)
- Sensitive keys (OpenAI, Mailgun) stored in Supabase Secrets
- Edge Functions access secrets via `Deno.env.get()`

### 4. Input Validation
```typescript
const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  subtitle: z.string().optional()
});
// Zod validates all form inputs
```

---

## Deployment Architecture

### Frontend Deployment
```
Source Code (GitHub)
    ↓
Vite Build (npm run build)
    ↓
Static Files (dist/)
    ↓
Deploy to Netlify/Vercel/Cloudflare Pages
    ↓
CDN serves static assets
```

**Environment Variables**:
```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Backend Deployment
```
Supabase Dashboard
    ↓
PostgreSQL (managed)
Auth (managed)
Storage (managed)
    ↓
Edge Functions deployed via CLI:
$ supabase functions deploy function-name
```

---

## Common User Journeys

### Journey 1: New User Creates First Book

1. User visits landing page (`/`)
2. Clicks "Get Started" → redirects to `/auth`
3. Signs up with email/password or magic link
4. Redirected to `/my-books` (empty state)
5. Clicks "Create New Book"
6. Fills form: title, subtitle, author
7. Submits → book created in database
8. First page automatically created
9. Redirected to `/book/:id/page/:pageId`
10. User clicks "Edit" → TipTap editor appears
11. Types content, formatting with toolbar
12. Content auto-saves on blur
13. User clicks "Next Page" or creates new page
14. Continues writing...

### Journey 2: Collaborating on a Book

1. Book owner opens book details
2. Clicks "Share" button
3. Enters collaborator email, selects "Edit" access
4. Clicks "Send Invitation"
5. Edge Function sends email with invitation link
6. Collaborator receives email, clicks link
7. Redirected to `/book/:bookId/join/:token`
8. If not logged in, prompted to sign up/login
9. After login, token is validated
10. Book access granted, redirected to book
11. Collaborator can now edit pages
12. Both users see each other's changes (refresh required)

### Journey 3: Sending Book to Kindle

1. User goes to `/settings/kindle`
2. Enters Kindle email address
3. Clicks "Send Verification Code"
4. Checks email, enters OTP
5. Kindle email verified and saved
6. User navigates to book details
7. Clicks "Send to Kindle"
8. Edge Function generates MOBI, sends via email
9. User receives book on Kindle device
10. Can read book on Kindle with proper formatting

---

## Key Technology Decisions

### Why React Query?
- Simplifies server state management
- Automatic caching reduces API calls
- Background refetching keeps data fresh
- Optimistic updates improve UX

### Why Supabase?
- PostgreSQL is robust, scalable
- RLS provides database-level security
- Auth is production-ready out of the box
- Edge Functions for serverless backend logic
- Real-time subscriptions (not currently used but available)

### Why TipTap?
- Headless editor (full control over UI)
- Extensible with custom extensions
- Collaborative editing support (future feature)
- Well-documented, active community

### Why shadcn/ui?
- Copy-paste components (no package dependency)
- Fully customizable with Tailwind
- Accessible by default (Radix UI primitives)
- Beautiful, modern design out of the box

---

## Testing & Development

### Local Development
```bash
npm run dev
# Vite dev server starts at http://localhost:5173
# Hot module replacement for instant feedback
```

### Building for Production
```bash
npm run build
# Creates optimized bundle in dist/
# Code splitting, minification, tree shaking
```

### Linting
```bash
npm run lint
# ESLint checks for code quality issues
```

---

## Future Architecture Considerations

### Real-Time Collaboration
- Could use Supabase Realtime subscriptions
- Or integrate Yjs for operational transformation
- Multiple users editing same page simultaneously

### Mobile Apps
- Could build React Native app
- Share business logic, different UI components
- Native mobile experience

### Offline Support
- Service workers for offline access
- IndexedDB for local storage
- Sync when connection restored

### Advanced Search
- Add more sophisticated NLP
- Support for filters (date, author, tags)
- Search across all user's books

---

## Troubleshooting Common Issues

### "Permission Denied" Errors
**Cause**: RLS policy blocking query
**Solution**: Check `book_access` table, verify user has access

### Editor Not Saving
**Cause**: Usually permission issue or network error
**Solution**: Check browser console for errors, verify `canEdit` is true

### Images Not Loading
**Cause**: Supabase Storage bucket not public or CORS issue
**Solution**: Check bucket policies in Supabase dashboard

### Slow Page Loads
**Cause**: Large images, too many pages, no caching
**Solution**: Enable page preloading, compress images, check React Query cache

---

## Summary

Pensive Books is a well-architected modern web application that demonstrates best practices in:
- React component design
- TypeScript type safety
- Supabase backend integration
- User authentication and authorization
- Rich text editing
- Performance optimization
- Security (RLS, input validation)

The codebase is organized logically with clear separation of concerns:
- **Pages**: Route-level components
- **Components**: Reusable UI elements
- **Hooks**: Shared logic
- **Utils**: Helper functions
- **Integrations**: External service connections

This architecture makes the codebase maintainable, testable, and extensible for future features.
