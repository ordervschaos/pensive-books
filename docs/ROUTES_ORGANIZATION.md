# Routes Organization

This document maps all application routes to their corresponding page components.

## Route Structure Overview

```
/Users/anzalansari/Work/pensive-books/src/
├── App.tsx (Router configuration)
└── pages/
    ├── Public Routes
    ├── Authentication Routes
    ├── Private User Routes
    ├── Private Book Routes
    ├── Private Page Routes
    ├── Settings Routes
    └── Legal/Info Routes
```

---

## 📂 Route Categories

### 🌐 Public Routes

| Route | Component | File | Description |
|-------|-----------|------|-------------|
| `/` | `Landing` | `Landing.tsx` | Landing/home page for non-authenticated users |
| `/library` | `Library` | `Library.tsx` | Public library of published books |
| `/privacy` | `PrivacyPolicy` | `PrivacyPolicy.tsx` | Privacy policy page |
| `/terms` | `Terms` | `Terms.tsx` | Terms of service page |
| `/contact` | `Contact` | `Contact.tsx` | Contact form/page |

### 🔐 Authentication Routes

| Route | Component | File | Description |
|-------|-----------|------|-------------|
| `/auth` | `Auth` | `Auth.tsx` | Login/signup page |
| `/auth/callback` | `Auth` | `Auth.tsx` | OAuth callback handler |

### 👤 Private User Routes

| Route | Component | File | Access | Description |
|-------|-----------|------|--------|-------------|
| `/my-books` | `MyBooks` | `MyBooks.tsx` | Private | User's book library/dashboard |
| `/profile/set-username` | `SetUsername` | `SetUsername.tsx` | Private | Set/update username |
| `/profile/edit` | `ProfileEdit` | `ProfileEdit.tsx` | Private | Edit user profile |
| `/:username` | `UserProfile` | `UserProfile.tsx` | Public | Public user profile view |

### 📚 Private Book Routes

| Route | Component | File | Access | Description |
|-------|-----------|------|--------|-------------|
| `/book/new` | `NewBook` | `NewBook.tsx` | Private | Create new book |
| `/book/:bookSlug` | `BookDetails` | `BookDetails.tsx` | Private | Book details and table of contents |
| `/book/:bookSlug/edit` | `BookEdit` | `BookEdit.tsx` | Private | Edit book metadata |
| `/book/:bookSlug/flashcards` | `BookFlashcards` | `BookFlashcards.tsx` | Private | Book flashcards view |
| `/book/generate` | `GenerateBook` | `GenerateBook.tsx` | Private | AI-powered book generation |

### 📄 Private Page Routes

| Route | Component | File | Access | Description |
|-------|-----------|------|--------|-------------|
| `/book/:bookSlug/page/:pageSlug` | `PageView` | `PageView.tsx` | Private | View/edit individual page |
| `/book/:bookSlug/version/:versionId` | `VersionPreview` | `VersionPreview.tsx` | Private | Preview specific book version |
| `/book/:bookSlug/version/:versionId/page/:pageSlug` | `VersionPageView` | `VersionPageView.tsx` | Private | View specific page version |

### 🌍 Public Library Routes

| Route | Component | File | Access | Description |
|-------|-----------|------|--------|-------------|
| `/library/book/:bookSlug` | `PublishedBookDetails` | `PublishedBookDetails.tsx` | Public | Published book details |
| `/library/book/:bookSlug/page/:pageSlug` | `PublishedPageView` | `PublishedPageView.tsx` | Public | Published page view |

### 🤝 Invitation & Join Routes

| Route | Component | File | Access | Description |
|-------|-----------|------|--------|-------------|
| `/accept-invitation` | `AcceptInvitation` | `AcceptInvitation.tsx` | Public | Accept collaboration invitation |
| `/book/:bookSlug/join/:token` | `JoinBook` | `JoinBook.tsx` | Public | Join book via invitation token |

### ⚙️ Settings Routes

| Route | Component | File | Access | Description |
|-------|-----------|------|--------|-------------|
| `/settings/kindle` | `KindleSettings` | `KindleSettings.tsx` | Private | Kindle integration settings |

---

## 🗂️ Route Grouping by Feature

### Book Management Flow
```
Create Book:     /book/new → /book/:bookSlug
Edit Book:       /book/:bookSlug → /book/:bookSlug/edit
View Book:       /book/:bookSlug → /book/:bookSlug/page/:pageSlug
Generate AI:     /book/generate → /book/:bookSlug
Flashcards:      /book/:bookSlug/flashcards
```

### Collaboration Flow
```
Invite:          Share link → /book/:bookSlug/join/:token
Accept:          /accept-invitation
Join:            /book/:bookSlug/join/:token → /book/:bookSlug
```

### Publishing Flow
```
Private View:    /book/:bookSlug
Public View:     /library/book/:bookSlug
Page View:       /library/book/:bookSlug/page/:pageSlug
```

### User Journey
```
Landing:         / → /auth → /profile/set-username → /my-books
Profile:         /:username → /profile/edit
Settings:        /settings/kindle
```

### Version Control Flow
```
Current:         /book/:bookSlug/page/:pageSlug
Version List:    /book/:bookSlug → versions
Version View:    /book/:bookSlug/version/:versionId
Version Page:    /book/:bookSlug/version/:versionId/page/:pageSlug
```

---

## 🔒 Access Control Summary

### Public Routes (9)
- `/` - Landing
- `/library` - Public library
- `/library/book/:bookSlug` - Published books
- `/library/book/:bookSlug/page/:pageSlug` - Published pages
- `/auth` - Authentication
- `/accept-invitation` - Accept invites
- `/book/:bookSlug/join/:token` - Join via token
- `/:username` - User profiles
- Legal pages (`/privacy`, `/terms`, `/contact`)

### Private Routes (13)
- `/my-books` - User's books
- `/book/new` - Create book
- `/book/:bookSlug` - Book details
- `/book/:bookSlug/edit` - Edit book
- `/book/:bookSlug/page/:pageSlug` - Edit pages
- `/book/:bookSlug/flashcards` - Flashcards
- `/book/:bookSlug/version/:versionId` - Version preview
- `/book/:bookSlug/version/:versionId/page/:pageSlug` - Version page
- `/book/generate` - AI generation
- `/profile/set-username` - Username setup
- `/profile/edit` - Profile editing
- `/settings/kindle` - Kindle settings

---

## 📊 Route Parameters

### Common Parameters
- `:bookSlug` - URL-friendly book identifier
- `:pageSlug` - URL-friendly page identifier
- `:username` - User's username
- `:token` - Invitation/join token
- `:versionId` - Version identifier

### Example URLs
```
/book/my-first-book
/book/my-first-book/page/introduction
/book/my-first-book/edit
/book/my-first-book/version/2024-03-15
/book/my-first-book/version/2024-03-15/page/chapter-1
/library/book/public-cookbook
/library/book/public-cookbook/page/recipe-1
/@john_doe
/book/shared-book/join/abc123xyz
```

---

## 🧭 Navigation Components

### Conditional Navigation
The app uses conditional navigation based on route:

```typescript
// App.tsx:49-58
function ConditionalNav() {
  const location = useLocation();
  const isLibraryRoute = location.pathname.startsWith('/library');

  if (isLibraryRoute) {
    return <LibraryNav />;  // Special nav for library routes
  }

  return <TopNav />;  // Default nav for all other routes
}
```

### Navigation Types
- **TopNav**: Default navigation for authenticated/private routes
- **LibraryNav**: Special navigation for public library routes

---

## 🔄 Route Migration Notes

### Slug-Based Routing
All book and page routes use slugs instead of IDs:
- ✅ `/book/my-book-title` (slug)
- ❌ `/book/123` (ID)

### Version Routes
Version routes include version ID in path:
- `/book/:bookSlug/version/:versionId`
- `/book/:bookSlug/version/:versionId/page/:pageSlug`

### Public vs Private Content
- Private content: `/book/:bookSlug/*`
- Public content: `/library/book/:bookSlug/*`

---

## 📝 Special Routes

### Catch-All User Profiles
The `/:username` route must be defined first to catch username patterns before other routes.

```typescript
// App.tsx:74
<Route path="/:username" element={<UserProfile />} />
```

### OAuth Callback
The `/auth/callback` route handles OAuth provider redirects:

```typescript
// App.tsx:78
<Route path="/auth/callback" element={<Auth />} />
```

---

## 🚀 Future Route Considerations

Potential routes for future features:
- `/book/:bookSlug/analytics` - Book analytics
- `/book/:bookSlug/comments` - Comment management
- `/book/:bookSlug/settings` - Book-specific settings
- `/templates` - Book templates
- `/explore` - Discover books
- `/notifications` - User notifications
- `/settings/account` - Account settings
- `/settings/preferences` - User preferences
- `/admin/*` - Admin routes

---

## 📚 Files Reference

All page components are located in:
```
/Users/anzalansari/Work/pensive-books/src/pages/
```

Router configuration:
```
/Users/anzalansari/Work/pensive-books/src/App.tsx
```

---

**Last Updated**: November 5, 2025
**Total Routes**: 22 unique routes
**Total Page Components**: 25 files
