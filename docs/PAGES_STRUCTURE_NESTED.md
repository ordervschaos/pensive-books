# Pages Directory Structure (Nested Organization)

The pages have been reorganized into a deeply nested, logical folder structure based on routes and functionality.

## Complete Directory Structure

```
src/pages/
│
├── auth/
│   └── Auth.tsx                           # Login/signup
│
├── public/
│   ├── landing/
│   │   └── Landing.tsx                    # Landing page (/)
│   ├── library/
│   │   └── Library.tsx                    # Public library (/library)
│   └── legal/
│       ├── Contact.tsx                    # Contact page
│       ├── PrivacyPolicy.tsx              # Privacy policy
│       └── Terms.tsx                      # Terms of service
│
├── user/
│   ├── library/
│   │   └── MyBooks.tsx                    # User's book library (/my-books)
│   └── profile/
│       ├── UserProfile.tsx                # Public user profile (/:username)
│       ├── SetUsername.tsx                # Username setup
│       └── ProfileEdit.tsx                # Edit profile
│
├── book/
│   ├── new/
│   │   └── NewBook.tsx                    # Create new book (/book/new)
│   ├── view/
│   │   ├── BookDetails.tsx                # Book details/TOC (/book/:bookSlug)
│   │   └── PublishedBookDetails.tsx       # Public book view (/library/book/:bookSlug)
│   ├── edit/
│   │   └── BookEdit.tsx                   # Edit book metadata (/book/:bookSlug/edit)
│   ├── flashcards/
│   │   └── BookFlashcards.tsx             # Book flashcards (/book/:bookSlug/flashcards)
│   └── generate/
│       └── GenerateBook.tsx               # AI book generation (/book/generate)
│
├── page/
│   ├── view/
│   │   ├── PageView.tsx                   # View/edit page (/book/:bookSlug/page/:pageSlug)
│   │   └── PublishedPageView.tsx          # Public page view (/library/book/:bookSlug/page/:pageSlug)
│   └── version/
│       ├── VersionPreview.tsx             # Version preview (/book/:bookSlug/version/:versionId)
│       └── VersionPageView.tsx            # Version page view (/book/:bookSlug/version/:versionId/page/:pageSlug)
│
├── invitation/
│   ├── AcceptInvitation.tsx               # Accept invite (/accept-invitation)
│   └── JoinBook.tsx                       # Join via token (/book/:bookSlug/join/:token)
│
├── settings/
│   └── KindleSettings.tsx                 # Kindle configuration (/settings/kindle)
│
└── RunMigration.tsx                       # Utility (not in route structure)
```

## Folder Organization By Purpose

### 📂 Public Pages (`public/`)
```
public/
├── landing/          → Landing & home pages
├── library/          → Public library features
└── legal/            → Legal & info pages (privacy, terms, contact)
```

### 📂 User Pages (`user/`)
```
user/
├── library/          → User's book collections
└── profile/          → Profile management & settings
```

### 📂 Book Pages (`book/`)
```
book/
├── new/              → Book creation
├── view/             → Book viewing (both private & public)
├── edit/             → Book editing
├── flashcards/       → Learning features
└── generate/         → AI generation features
```

### 📂 Page Pages (`page/`)
```
page/
├── view/             → Page viewing & editing
└── version/          → Version control & history
```

### 📂 Other Folders
- **`auth/`** - Authentication (single file)
- **`invitation/`** - Collaboration & sharing (2 files)
- **`settings/`** - Application settings (single file)

## Import Structure in App.tsx

All imports are now organized with deeper paths:

```typescript
// Public pages - organized by sub-feature
import Landing from "@/pages/public/landing/Landing";
import Library from "@/pages/public/library/Library";
import PrivacyPolicy from "@/pages/public/legal/PrivacyPolicy";
import Terms from "@/pages/public/legal/Terms";
import Contact from "@/pages/public/legal/Contact";

// Auth pages
import Auth from "@/pages/auth/Auth";

// User pages - organized by library vs profile
import MyBooks from "@/pages/user/library/MyBooks";
import UserProfile from "@/pages/user/profile/UserProfile";
import SetUsername from "@/pages/user/profile/SetUsername";
import ProfileEdit from "@/pages/user/profile/ProfileEdit";

// Book pages - organized by action (new/view/edit/etc)
import NewBook from "@/pages/book/new/NewBook";
import BookDetails from "@/pages/book/view/BookDetails";
import BookEdit from "@/pages/book/edit/BookEdit";
import BookFlashcards from "@/pages/book/flashcards/BookFlashcards";
import GenerateBook from "@/pages/book/generate/GenerateBook";
import PublishedBookDetails from "@/pages/book/view/PublishedBookDetails";

// Page pages - organized by view vs version
import PageView from "@/pages/page/view/PageView";
import VersionPreview from "@/pages/page/version/VersionPreview";
import VersionPageView from "@/pages/page/version/VersionPageView";
import PublishedPageView from "@/pages/page/view/PublishedPageView";

// Invitation pages
import AcceptInvitation from "@/pages/invitation/AcceptInvitation";
import JoinBook from "@/pages/invitation/JoinBook";

// Settings pages
import KindleSettings from "@/pages/settings/KindleSettings";
```

## Route to File Mapping

### Public Routes
| Route | File Path |
|-------|-----------|
| `/` | `public/landing/Landing.tsx` |
| `/library` | `public/library/Library.tsx` |
| `/privacy` | `public/legal/PrivacyPolicy.tsx` |
| `/terms` | `public/legal/Terms.tsx` |
| `/contact` | `public/legal/Contact.tsx` |

### Auth Routes
| Route | File Path |
|-------|-----------|
| `/auth` | `auth/Auth.tsx` |

### User Routes
| Route | File Path |
|-------|-----------|
| `/my-books` | `user/library/MyBooks.tsx` |
| `/:username` | `user/profile/UserProfile.tsx` |
| `/profile/set-username` | `user/profile/SetUsername.tsx` |
| `/profile/edit` | `user/profile/ProfileEdit.tsx` |

### Book Routes
| Route | File Path |
|-------|-----------|
| `/book/new` | `book/new/NewBook.tsx` |
| `/book/:bookSlug` | `book/view/BookDetails.tsx` |
| `/book/:bookSlug/edit` | `book/edit/BookEdit.tsx` |
| `/book/:bookSlug/flashcards` | `book/flashcards/BookFlashcards.tsx` |
| `/book/generate` | `book/generate/GenerateBook.tsx` |
| `/library/book/:bookSlug` | `book/view/PublishedBookDetails.tsx` |

### Page Routes
| Route | File Path |
|-------|-----------|
| `/book/:bookSlug/page/:pageSlug` | `page/view/PageView.tsx` |
| `/book/:bookSlug/version/:versionId` | `page/version/VersionPreview.tsx` |
| `/book/:bookSlug/version/:versionId/page/:pageSlug` | `page/version/VersionPageView.tsx` |
| `/library/book/:bookSlug/page/:pageSlug` | `page/view/PublishedPageView.tsx` |

### Other Routes
| Route | File Path |
|-------|-----------|
| `/accept-invitation` | `invitation/AcceptInvitation.tsx` |
| `/book/:bookSlug/join/:token` | `invitation/JoinBook.tsx` |
| `/settings/kindle` | `settings/KindleSettings.tsx` |

## Benefits of Nested Structure

### 1. **Logical Grouping**
- Related features are co-located
- Clear separation by functionality
- Easier to locate files

### 2. **Scalability**
- Easy to add new features to existing groups
- Can add more subfolders as features grow
- Clear place for new pages

### 3. **Code Organization**
- Public vs private pages clearly separated
- View vs edit operations grouped
- Version control isolated in own folder

### 4. **Developer Experience**
- Intuitive file locations
- Self-documenting structure
- Clear intent from folder names

### 5. **Maintenance**
- Related files grouped together
- Changes to feature stay in one area
- Easier refactoring

## Subfolder Categories

### By Action Type
```
book/
├── new/              # Creation actions
├── view/             # Viewing actions
├── edit/             # Editing actions
├── flashcards/       # Learning actions
└── generate/         # Generation actions
```

### By Access Level
```
book/view/
├── BookDetails.tsx           # Private
└── PublishedBookDetails.tsx  # Public

page/view/
├── PageView.tsx              # Private
└── PublishedPageView.tsx     # Public
```

### By Feature Type
```
user/
├── library/          # Collection management
└── profile/          # Account management

public/
├── landing/          # Marketing
├── library/          # Content discovery
└── legal/            # Legal/compliance
```

## File Statistics

| Category | Folders | Files | Depth |
|----------|---------|-------|-------|
| **auth/** | 1 | 1 | 1 level |
| **public/** | 4 | 5 | 2 levels |
| **user/** | 3 | 4 | 2 levels |
| **book/** | 6 | 6 | 2 levels |
| **page/** | 3 | 4 | 2 levels |
| **invitation/** | 1 | 2 | 1 level |
| **settings/** | 1 | 1 | 1 level |
| **Total** | **19** | **24** | **2 max** |

## Adding New Pages

### Where to Add New Pages

**Public content pages:**
```
public/library/         → New library features
public/legal/           → New legal pages
public/landing/         → New landing variations
```

**User features:**
```
user/library/           → New collection features
user/profile/           → New profile features
user/settings/          → New user settings (create folder)
```

**Book features:**
```
book/new/               → Book creation variants
book/view/              → New view modes
book/edit/              → New editing features
book/[feature-name]/    → New book features
```

**Page features:**
```
page/view/              → New viewing modes
page/version/           → Version control features
page/[feature-name]/    → New page features
```

## Migration Notes

### From Flat to Nested
```
Before: pages/BookDetails.tsx
After:  pages/book/view/BookDetails.tsx

Before: pages/Landing.tsx
After:  pages/public/landing/Landing.tsx

Before: pages/PageView.tsx
After:  pages/page/view/PageView.tsx
```

### Import Path Changes
```
Before: import BookDetails from "@/pages/book/BookDetails";
After:  import BookDetails from "@/pages/book/view/BookDetails";

Before: import Landing from "@/pages/public/Landing";
After:  import Landing from "@/pages/public/landing/Landing";
```

---

**Last Updated**: November 5, 2025
**Structure Version**: 2.0 (Nested)
**Total Files**: 24 page components
**Total Folders**: 19 directories
**Max Depth**: 2 levels
**Build Status**: ✅ All imports working correctly
