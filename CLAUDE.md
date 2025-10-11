# Pensive Books - Codebase Documentation

## Project Overview

**Pensive** is a collaborative book/notebook creation and management platform built with React, TypeScript, and Supabase. It allows users to create, edit, and share digital books with rich text editing capabilities, collaboration features, and Kindle integration.

### Key Features
- Digital book creation and management
- Rich text editor with TipTap
- Real-time collaboration with access control (view/edit)
- Book sharing and invitation system
- Page history tracking
- Kindle integration (send books to Kindle)
- Public/private book visibility
- Unsplash image integration for book covers
- AI-powered book content generation
- Search functionality across books and pages

## Technology Stack

| Category | Technology |
|----------|-----------|
| **Frontend** | React 18, TypeScript |
| **Build Tool** | Vite |
| **Routing** | React Router v6 |
| **UI Framework** | shadcn/ui (Radix UI components) |
| **Styling** | Tailwind CSS |
| **Backend** | Supabase (PostgreSQL) |
| **Authentication** | Supabase Auth |
| **Rich Text Editor** | TipTap v2 |
| **State Management** | React Query (TanStack Query) |
| **Drag & Drop** | @dnd-kit |
| **Forms** | React Hook Form + Zod |
| **Themes** | next-themes |

## Project Structure

```
pensive-books/
├── src/
│   ├── components/
│   │   ├── book/              # Book-related components
│   │   │   ├── BookGrid.tsx           # Grid view of books
│   │   │   ├── BookInfo.tsx           # Book details display
│   │   │   ├── BookCoverEdit.tsx      # Cover image editing
│   │   │   ├── BookEditForm.tsx       # Book metadata editing
│   │   │   ├── InviteCollaboratorSheet.tsx
│   │   │   ├── ManageCollaboratorsSheet.tsx
│   │   │   ├── ShareBookSheet.tsx     # Book sharing UI
│   │   │   ├── UnsplashPicker.tsx     # Image picker for covers
│   │   │   └── pageList/              # Page list components
│   │   ├── editor/            # Rich text editor components
│   │   │   ├── TipTapEditor.tsx       # Main editor component
│   │   │   ├── EditorToolbar.tsx      # Editor toolbar
│   │   │   ├── extensions/            # Custom TipTap extensions
│   │   │   └── config/                # Editor configuration
│   │   ├── page/              # Page-related components
│   │   │   ├── PageContent.tsx        # Page content display
│   │   │   ├── PageNavigation.tsx     # Page navigation UI
│   │   │   ├── PageHistory.tsx        # Page version history
│   │   │   ├── TableOfContents.tsx    # TOC component
│   │   │   └── PagePreloader.tsx      # Page preloading logic
│   │   ├── navigation/        # Navigation components
│   │   ├── search/            # Search functionality
│   │   │   └── SearchDialog.tsx
│   │   ├── theme/             # Theme provider
│   │   │   └── ThemeProvider.tsx
│   │   ├── ui/                # shadcn/ui components (50+ components)
│   │   ├── TopNav.tsx         # Top navigation bar
│   │   ├── Footer.tsx         # Footer component
│   │   └── PrivateRoute.tsx   # Auth route wrapper
│   ├── pages/                 # Route pages
│   │   ├── Landing.tsx        # Landing page
│   │   ├── Auth.tsx           # Authentication page
│   │   ├── Library.tsx        # Public library view
│   │   ├── MyBooks.tsx        # User's book list
│   │   ├── NewBook.tsx        # Create new book
│   │   ├── BookDetails.tsx    # Book details view
│   │   ├── BookEdit.tsx       # Edit book metadata
│   │   ├── PageView.tsx       # View/edit single page
│   │   ├── PageHistoryView.tsx # Page history viewer
│   │   ├── AcceptInvitation.tsx # Accept collaboration invite
│   │   ├── JoinBook.tsx       # Join book via token
│   │   ├── UserProfile.tsx    # User profile page
│   │   ├── SetUsername.tsx    # Set username
│   │   ├── GenerateBook.tsx   # AI book generation
│   │   ├── KindleSettings.tsx # Kindle configuration
│   │   ├── PrivacyPolicy.tsx
│   │   ├── Terms.tsx
│   │   └── Contact.tsx
│   ├── hooks/                 # Custom React hooks
│   │   ├── use-book-permissions.ts   # Book access control
│   │   ├── use-supabase-upload.ts    # File upload logic
│   │   ├── use-session.ts            # Session management
│   │   ├── use-toast.ts              # Toast notifications
│   │   ├── use-media-query.ts        # Responsive helpers
│   │   ├── useGoogleAnalytics.ts     # Analytics tracking
│   │   └── usePagePreloader.ts       # Page preloading
│   ├── integrations/
│   │   └── supabase/
│   │       ├── client.ts      # Supabase client setup
│   │       └── types.ts       # Database type definitions
│   ├── services/
│   │   └── PageCache.ts       # Page caching service
│   ├── utils/
│   │   ├── pageTitle.ts       # Page title helpers
│   │   ├── metaTags.ts        # Meta tag generation
│   │   └── pagePreloader.ts   # Page preload utilities
│   ├── lib/
│   │   └── utils.ts           # Utility functions
│   ├── App.tsx                # Root app component
│   ├── main.tsx               # App entry point
│   └── index.css              # Global styles
├── supabase/
│   └── functions/             # Supabase Edge Functions
│       ├── get-secret/        # Retrieve API secrets
│       ├── send-book-invitation/ # Send collaboration emails
│       ├── send-kindle-verification/ # Kindle email verification
│       ├── send-to-kindle/    # Send book to Kindle
│       ├── flesh-out-book/    # AI book structure generation
│       ├── generate-book-content/ # AI content generation
│       └── get-kindle-token/  # Kindle integration token
├── public/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
└── README.md
```

## Database Schema

### Core Tables

#### `books`
Stores book metadata and content
- `id`: Primary key
- `name`: Book title
- `subtitle`: Book subtitle
- `author`: Book author
- `owner_id`: UUID reference to user
- `cover_url`: Cover image URL
- `photographer`: Cover photo credit
- `photographer_username`: Unsplash photographer username
- `is_public`: Boolean for public visibility
- `is_archived`: Boolean for archived status
- `pinned`: Boolean for pinned status
- `page_ids`: JSON array of page IDs (ordering)
- `slug`: URL-friendly slug
- `show_text_on_cover`: Boolean for cover text display
- `bookmarked_page_index`: Current reading position
- `digest_bookmarked_page_index`: Digest reading position
- `edit_invitation_token`: Token for edit access
- `view_invitation_token`: Token for view access
- `created_at`, `updated_at`, `published_at`, `last_published_at`, `last_read`

#### `pages`
Individual pages/sections within books
- `id`: Primary key
- `book_id`: Foreign key to books
- `owner_id`: UUID reference to user
- `title`: Page title
- `content`: JSON content (TipTap format)
- `html_content`: HTML representation
- `old_content`: Legacy content format
- `page_index`: Order within book
- `page_type`: Type (e.g., "text", "section")
- `slug`: URL-friendly slug
- `embedding`: Vector embedding for search
- `archived`: Boolean for archived status
- `created_at`, `updated_at`, `last_published_at`

#### `page_history`
Version history for pages
- `id`: Primary key
- `page_id`: Foreign key to pages
- `html_content`: Historical HTML content
- `created_by`: User who created this version
- `batch_id`: Groups related changes
- `created_at`: Timestamp
- `created_at_minute`: Timestamp rounded to minute (for deduplication)

#### `book_access`
Collaboration and access control
- `id`: Primary key
- `book_id`: Foreign key to books
- `user_id`: UUID of user with access
- `invited_email`: Email of invited user
- `created_by`: UUID of inviter
- `access_level`: Enum ('view' | 'edit')
- `status`: Invitation status
- `invitation_token`: Unique token for invitation
- `created_at`

#### `user_data`
User profiles and settings
- `user_id`: Primary key (UUID)
- `email`: User email
- `username`: Unique username
- `timezone`: User timezone
- `default_notebook`: Default book ID
- `kindle_email`: Kindle email address
- `kindle_configured`: Boolean for Kindle setup
- `kindle_verification_otp`: OTP for verification
- `kindle_verification_expires`: OTP expiration
- `bookmarked_pages`: JSON of bookmarked pages
- `one_time_events`: JSON of UI events/tutorials shown
- `created_at`, `updated_at`

#### `reminders`
Reminder/notification scheduling
- `id`: Primary key
- `owner_id`: UUID reference to user
- `book_id`: Optional book reference
- `page_id`: Optional page reference
- `reminder_type`: Type of reminder
- `time`: Time for reminder
- `repeat_type`: Recurrence type
- `repeat_config`: JSON configuration
- `read_option`: Reading preference
- `is_active`: Boolean for active status
- `archived`: Boolean for archived status
- `created_at`, `updated_at`

#### `notifications`
Generated notification instances
- `id`: Primary key
- `owner_id`: UUID reference to user
- `reminder_id`: Foreign key to reminders
- `notebook_id`: Book reference
- `page_id`: Page reference
- `due_at`: Due date/time
- `status`: Notification status
- `repeat_description`: Human-readable repeat info
- `unique_id`: Unique identifier for deduplication
- `archived`: Boolean for archived status
- `created_at`, `updated_at`

#### `leads`
Marketing leads/waitlist
- `id`: Primary key
- `email`: Email address
- `name`: Optional name
- `source`: Lead source
- `created_at`

### Database Functions

- `generate_slug(input_text)`: Generates URL-friendly slugs
- `check_book_access(book_id, user_email)`: Checks if user has access to book
- `search_book_contents(search_query, book_id)`: Full-text search within book
- `highlight_search_results_in_page(search_query)`: Search with highlighting
- `match_documents(query_embedding, ...)`: Vector similarity search
- `similarity_search(...)`: Semantic search using embeddings
- `vector_page_search(...)`: Page search with embeddings
- `create_next_page(p_book_id)`: Creates next sequential page

## Row-Level Security (RLS)

### Book Policies
- **View**: Users can view books if:
  1. They own the book (`owner_id = auth.uid()`)
  2. The book is public (`is_public = true`)
  3. They have granted access via `book_access` table
- **Create**: Users can only create books where they are the owner
- **Update**: Only book owners can update books
- **Delete**: Only book owners can delete books

### Page Policies
- **View**: Users can view pages if they have access to the parent book
- **Create/Update**: Only book owners and editors can modify pages
- **Delete**: Only book owners and editors can delete pages

### Access Control
- Book access is managed through the `book_access` table
- Two access levels: `view` and `edit`
- Access can be granted via email or user ID
- Invitation tokens allow joining via links

### User Data Policies
- Users can only view/update/delete their own data
- All operations enforce `owner_id = auth.uid()`

## Application Routes

| Route | Component | Access | Description |
|-------|-----------|--------|-------------|
| `/` | Landing | Public | Landing page |
| `/auth` | Auth | Public | Login/signup |
| `/library` | Library | Public | Public book library |
| `/my-books` | MyBooks | Private | User's books |
| `/book/new` | NewBook | Private | Create new book |
| `/book/:id` | BookDetails | Private | Book details/TOC |
| `/book/:id/edit` | BookEdit | Private | Edit book metadata |
| `/book/:bookId/page/:pageId` | PageView | Private | View/edit page |
| `/book/:bookId/page/:pageId/history` | PageHistoryView | Private | Page history |
| `/book/:bookId/join/:token` | JoinBook | Public | Accept invitation |
| `/accept-invitation` | AcceptInvitation | Public | Accept collaboration |
| `/generate-book` | GenerateBook | Private | AI book generation |
| `/settings/kindle` | KindleSettings | Private | Kindle configuration |
| `/set-username` | SetUsername | Private | Set username |
| `/:username` | UserProfile | Public | User profile |
| `/privacy` | PrivacyPolicy | Public | Privacy policy |
| `/terms` | Terms | Public | Terms of service |
| `/contact` | Contact | Public | Contact form |

## Key Components

### Rich Text Editor (`src/components/editor/`)
- **TipTapEditor.tsx**: Main editor component using TipTap v2
- **EditorToolbar.tsx**: Formatting toolbar with buttons for:
  - Text formatting (bold, italic, underline)
  - Headers (H1, H2, H3)
  - Lists (bullet, numbered)
  - Code blocks with syntax highlighting
  - Tables
  - Links and images
  - Text alignment
- **extensions/SectionDocument.ts**: Custom TipTap extension for section-based documents

### Book Management (`src/components/book/`)
- **BookGrid.tsx**: Displays books in a grid layout
- **BookInfo.tsx**: Detailed book information panel
- **BookCoverEdit.tsx**: Cover image upload/editing
- **UnsplashPicker.tsx**: Search and select Unsplash images
- **InviteCollaboratorSheet.tsx**: Invite users to collaborate
- **ManageCollaboratorsSheet.tsx**: View and manage collaborators
- **ShareBookSheet.tsx**: Public sharing options
- **pageList/**: Components for displaying and managing page lists

### Page Components (`src/components/page/`)
- **PageContent.tsx**: Main page content renderer
- **PageNavigation.tsx**: Previous/next page navigation
- **PageHistory.tsx**: Version history viewer
- **TableOfContents.tsx**: Book TOC navigation
- **PagePreloader.tsx**: Preloads adjacent pages for better performance

### Navigation (`src/components/navigation/`)
- Top navigation bar with user menu
- Book/page navigation
- Search functionality

### Search (`src/components/search/`)
- **SearchDialog.tsx**: Global search across books and pages
- Supports full-text search and semantic search

## Custom Hooks

### `use-book-permissions.ts`
Checks user permissions for book actions:
- `canEdit`: Can user edit the book?
- `canView`: Can user view the book?
- `isOwner`: Is user the book owner?

### `use-supabase-upload.ts`
Handles file uploads to Supabase Storage:
- Image compression
- Progress tracking
- Error handling

### `use-session.ts`
Manages user session state:
- Session data
- Authentication status
- User profile

### `useGoogleAnalytics.ts`
Tracks page views and events with Google Analytics

### `usePagePreloader.ts`
Preloads adjacent pages for faster navigation

## Supabase Edge Functions

### `get-secret`
Retrieves API secrets from Supabase Secrets Manager
- Used by client to fetch API keys securely
- Supports: UNSPLASH_ACCESS_KEY, MAILGUN_API_KEY, etc.

### `send-book-invitation`
Sends email invitations to collaborators
- Uses Mailgun API
- Includes invitation link with token

### `send-kindle-verification`
Sends verification email for Kindle setup
- Generates OTP
- Validates Kindle email

### `send-to-kindle`
Converts book to MOBI format and sends to Kindle
- Generates EPUB from book content
- Converts to MOBI using Calibre
- Sends via email to Kindle

### `generate-book-content`
AI-powered content generation for books
- Uses OpenAI API
- Generates content based on prompts
- Creates pages with structured content

### `flesh-out-book`
AI-powered book structure generation
- Creates table of contents
- Suggests sections and chapters
- Generates outline from topic/description

### `get-kindle-token`
Manages Kindle integration tokens
- Validates OTP
- Sets up Kindle email

## Environment Variables

### Client-side (.env)
```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Server-side (Supabase Secrets)
```bash
UNSPLASH_ACCESS_KEY=your-unsplash-key
UNSPLASH_SECRET_KEY=your-unsplash-secret
MAILGUN_API_KEY=your-mailgun-key
MAILGUN_DOMAIN=your-mailgun-domain
OPENAI_API_KEY=your-openai-key  # For AI generation
```

## Key Libraries

### UI & Styling
- **shadcn/ui**: 50+ pre-built accessible components
- **Radix UI**: Headless UI primitives
- **Tailwind CSS**: Utility-first CSS framework
- **Framer Motion**: Animation library
- **lucide-react**: Icon library

### Editor
- **@tiptap/react**: Headless editor framework
- **@tiptap/starter-kit**: Basic editor extensions
- **lowlight**: Syntax highlighting for code blocks

### Data & State
- **@tanstack/react-query**: Server state management
- **react-hook-form**: Form management
- **zod**: Schema validation

### Drag & Drop
- **@dnd-kit/core**: Drag and drop toolkit
- **@dnd-kit/sortable**: Sortable lists

### Other
- **date-fns**: Date manipulation
- **recharts**: Charting library
- **jsPDF**: PDF generation
- **html2canvas**: Screenshot generation
- **jszip**: ZIP file handling
- **browser-image-compression**: Image compression

## Development Workflow

### Local Development
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run build:dev    # Development build
npm run preview      # Preview production build
npm run lint         # Run ESLint
```

### Supabase CLI Commands
```bash
supabase login                              # Login to Supabase
supabase link --project-ref your-ref        # Link to project
supabase functions deploy                   # Deploy all functions
supabase functions serve function-name      # Test function locally
supabase secrets set KEY=value              # Set secret
```

## Code Patterns & Best Practices

### Data Fetching
```typescript
// Use React Query for server state
import { useQuery } from '@tanstack/react-query';

const { data, isLoading } = useQuery({
  queryKey: ['books', userId],
  queryFn: () => fetchUserBooks(userId)
});
```

### Supabase Queries
```typescript
// Books with RLS automatically applied
const { data: books } = await supabase
  .from('books')
  .select('*, pages(*)')
  .eq('owner_id', userId)
  .order('updated_at', { ascending: false });
```

### Access Control
```typescript
// Check permissions before actions
const { canEdit, isOwner } = useBookPermissions(bookId);

if (!canEdit) {
  return <div>No permission to edit</div>;
}
```

### Form Validation
```typescript
// Use React Hook Form with Zod
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  subtitle: z.string().optional()
});

const form = useForm({
  resolver: zodResolver(schema)
});
```

## Common Tasks

### Adding a New Page
1. Navigate to book details
2. Click "Add Page" or use page list
3. Page is created with `create_next_page()` function
4. Automatically added to book's `page_ids` array

### Sharing a Book
1. Book owner opens share sheet
2. Can toggle `is_public` for public access
3. Or invite specific users via email
4. Access level: view or edit
5. Invitation sent via email with token

### Editing Book Content
1. Navigate to page view
2. TipTap editor loads page content
3. Content auto-saves on blur/change
4. History tracked in `page_history` table

### Sending to Kindle
1. User configures Kindle email in settings
2. Verify email with OTP
3. From book details, click "Send to Kindle"
4. Edge function generates MOBI and emails it

## Performance Optimizations

### Page Preloading
- Adjacent pages preloaded when viewing a page
- Uses `PagePreloader` component and service
- Caches content in `PageCache` service

### Image Optimization
- Images compressed before upload
- Uses `browser-image-compression` library
- Unsplash images use optimized URLs

### Query Optimization
- React Query caching reduces redundant requests
- Supabase queries use selective column fetching
- Pagination for large datasets

### Code Splitting
- Route-based code splitting with React Router
- Lazy loading of components where appropriate

## Deployment

### Recommended Platforms
- **Netlify**: Easiest deployment with Git integration
- **Vercel**: Excellent for React/Vite projects
- **Cloudflare Pages**: Fast global CDN

### Deployment Steps
1. Connect Git repository
2. Set build command: `npm run build`
3. Set publish directory: `dist`
4. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy Supabase Edge Functions separately via CLI

## Troubleshooting

### Common Issues

**RLS Policies Not Working**
- Verify user is authenticated: `auth.uid()` returns value
- Check policy conditions match your use case
- Review Supabase logs for policy violations

**Edge Functions Timing Out**
- Check function logs in Supabase dashboard
- Verify secrets are set correctly
- Test locally with `supabase functions serve`

**Editor Not Saving**
- Check network tab for failed requests
- Verify user has edit permissions
- Check RLS policies on `pages` table

**Images Not Loading**
- Verify Supabase Storage bucket is public
- Check CORS settings in Supabase
- Ensure image URLs are correct

## Future Enhancements

Potential areas for improvement:
- Real-time collaborative editing (Yjs integration)
- Mobile apps (React Native)
- Export to more formats (EPUB, PDF)
- Advanced AI features (summarization, Q&A)
- Social features (comments, reactions)
- Analytics dashboard for book engagement
- Version control/branching for books
- Templates and themes

## Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [TipTap Documentation](https://tiptap.dev/)
- [shadcn/ui Components](https://ui.shadcn.com/)
- [React Query Documentation](https://tanstack.com/query/latest)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

---

**Last Updated**: October 2025
**Version**: 1.0
