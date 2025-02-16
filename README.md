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

### Environment Variables and API Keys

The project uses several external services that require API keys. These are securely stored in Supabase:

1. **Supabase Configuration**
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_ANON_KEY`: Your project's anon/public key
   - `SUPABASE_SERVICE_ROLE_KEY`: For Edge Functions

2. **Image Services**
   - `UNSPLASH_ACCESS_KEY`: For Unsplash image search
   - `UNSPLASH_SECRET_KEY`: Unsplash API secret key

3. **Email Services**
   - `MAILGUN_API_KEY`: For sending emails
   - `MAILGUN_DOMAIN`: Your Mailgun domain

To set up these variables:
1. Go to your Supabase Dashboard
2. Navigate to Project Settings > API
3. Find the "Project Secrets" section
4. Add each required secret

The application uses Supabase Edge Functions to securely access these secrets, so they're never exposed to the client.

### Edge Functions Setup

The project uses Supabase Edge Functions to securely handle API keys and perform server-side operations. Here's how to set them up:

1. **Install Supabase CLI**
   ```bash
   # Install Supabase CLI if you haven't already
   npm install -g supabase
   ```

2. **Initialize Edge Functions**
   ```bash
   # Login to Supabase CLI
   supabase login

   # Link your project (if not already linked)
   supabase link --project-ref your-project-ref
   ```

3. **Deploy Edge Functions**
   ```bash
   # Deploy all functions
   supabase functions deploy

   # Deploy a specific function
   supabase functions deploy get-secret
   supabase functions deploy send-book-invitation
   ```

4. **Managing Secrets**
   ```bash
   # Add a new secret
   supabase secrets set MY_API_KEY=value

   # Set multiple secrets at once
   supabase secrets set --env-file .env.production
   ```

#### Available Edge Functions

1. **get-secret**
   - Purpose: Securely retrieve API keys and secrets
   - Usage: 
     ```typescript
     const { data: secrets } = await supabase.functions.invoke('get-secret', {
       body: { secretNames: ['API_KEY_NAME'] }
     });
     ```

2. **send-book-invitation**
   - Purpose: Send email invitations for book collaboration
   - Uses: Mailgun API for email delivery
   - Automatically creates book access records
   - Definition:
     ```typescript
     // supabase/functions/send-book-invitation/index.ts
     interface EmailRequest {
       email: string;
       bookId: number;
       accessLevel: "view" | "edit";
     }

     // Function implementation
     serve(async (req) => {
       const { email, bookId, accessLevel }: EmailRequest = await req.json()
       
       // Create book access record
       const { error: accessError } = await supabaseClient
         .from('book_access')
         .insert({
           book_id: bookId,
           access_level: accessLevel,
           created_by: user.id,
           invited_email: email,
           status: 'pending'
         })

       // Send email using Mailgun
       const mailgunEndpoint = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`
       // ... email sending logic
     })
     ```
   - Usage:
     ```typescript
     const { data, error } = await supabase.functions.invoke('send-book-invitation', {
       body: { 
         email: 'user@example.com',
         bookId: 123,
         accessLevel: 'edit'
       }
     });
     ```
   - Required Secrets:
     ```bash
     # Set up Mailgun credentials
     supabase secrets set MAILGUN_API_KEY=your_api_key
     supabase secrets set MAILGUN_DOMAIN=your_domain
     
     # Set up Supabase service role key (if not already set)
     supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
     ```

#### Local Development

1. **Run Functions Locally**
   ```bash
   # Start the Functions emulator
   supabase start
   
   # Serve a specific function
   supabase functions serve get-secret --no-verify-jwt
   ```

2. **Testing Functions**
   ```bash
   # Test with curl
   curl -L -X POST 'http://localhost:54321/functions/v1/get-secret' \
   -H 'Authorization: Bearer YOUR_ANON_KEY' \
   -d '{"secretNames":["UNSPLASH_ACCESS_KEY"]}'
   ```

3. **Environment Variables**
   - Create a `.env` file in the `supabase/functions` directory
   - Add your development secrets
   - These won't be committed to version control

For more information about Edge Functions, visit the [Supabase Edge Functions documentation](https://supabase.com/docs/guides/functions).

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
