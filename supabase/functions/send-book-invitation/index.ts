import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EmailRequest {
  email: string;
  bookId: number;
  accessLevel: "view" | "edit";
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) {
      throw new Error('Missing RESEND_API_KEY')
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get request body
    const { email, bookId, accessLevel }: EmailRequest = await req.json()

    // Get book details
    const { data: book, error: bookError } = await supabaseClient
      .from('books')
      .select('name, owner_id')
      .eq('id', bookId)
      .single()

    if (bookError) throw bookError

    // Get owner details
    const { data: { user }, error: userError } = await supabaseClient.auth.admin.getUserById(
      book.owner_id
    )

    if (userError) throw userError

    // Send email using Resend
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Book Collaboration <onboarding@resend.dev>',
        to: [email],
        subject: `You've been invited to collaborate on "${book.name}"`,
        html: `
          <p>Hello,</p>
          <p>${user?.email} has invited you to collaborate on their book "${book.name}" with ${accessLevel} access.</p>
          <p>Click the link below to accept the invitation:</p>
          <p><a href="${Deno.env.get('PUBLIC_SITE_URL')}/accept-invitation?bookId=${bookId}&email=${email}">Accept Invitation</a></p>
        `,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.message)
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('Error in send-book-invitation function:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})