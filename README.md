# Welcome to Pensive Books
## How to run the project locally
Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```


## What technologies are used for this project?

This project is built with .

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
- Supabase (Database & Authentication)

## Database Setup

This project uses Supabase as its database provider. To set up your own instance:

1. Create a new project on [Supabase](https://supabase.com)
2. Clone this repository
3. Copy the schema to your Supabase instance:
   ```bash
   # Install Supabase CLI if you haven't already
   npm install -g supabase-cli

   # Link your project (you'll need your project ref and database password)
   supabase link --project-ref your-project-ref

   # Apply the schema
   psql -h your-db-host -d postgres -U postgres -f schema.sql
   ```

4. Set up your environment variables:
   ```
   SUPABASE_URL=your-project-url
   SUPABASE_ANON_KEY=your-anon-key
   ```

The database schema includes the following main tables:
- Books: Stores book metadata and content
- Pages: Individual pages or sections of books
- Users: User information and preferences
- Annotations: User notes and highlights

For detailed schema information, check the `schema.sql` file in the repository.

### Row Level Security (RLS)

The database implements Row Level Security to ensure data privacy and access control. Below is a detailed breakdown of the security policies:

#### Book Access Control
- **Ownership Policies**
  - `Users can create books`: Users can only create books where they are the owner
  - `Users can delete their own books`: Only book owners can delete their books
  - `Users can update their own books`: Book updates restricted to owners

- **Viewing Policies**
  - Books are visible to users if any of these conditions are met:
    1. They own the book (`owner_id = auth.uid()`)
    2. The book is public (`is_public = true`)
    3. They have been granted access through `book_access` table

#### Book Sharing System
- **Access Management**
  - Users can manage access to their own books
  - Access can be granted via email or user ID
  - Two access levels supported: 'view' and 'edit'
  - Access records can be revoked by the book owner

#### Page Security
- **Page Access Policies**
  - `pages_select_policy`: Users can view pages if they:
    1. Own the parent book
    2. Have been granted access to the parent book
    3. The parent book is public
  - `pages_insert_policy`: Only book owners and editors can create pages
  - `pages_update_policy`: Updates restricted to book owners and editors

#### User Data Protection
- **Personal Data**
  - `select_user_data`: Users can only view their own data
  - `update_user_data`: Users can only update their own data
  - `delete_user_data`: Users can only delete their own data

- **Notifications & Reminders**
  - All notification policies enforce owner-only access
  - Automatic filtering based on `owner_id = auth.uid()`
  - Includes separate policies for CRUD operations

#### Implementation Notes
- All policies use `auth.uid()` for user identification
- Policies are automatically enforced by Supabase
- No manual policy checks needed in application code
- Policies cannot be bypassed from the client side

For the complete set of security policies and their SQL implementations, refer to the `schema.sql` file.

## How can I deploy this project?
