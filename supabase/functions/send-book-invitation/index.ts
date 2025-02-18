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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get request body
    const { email, bookId, accessLevel }: EmailRequest = await req.json()

    // Get the current user's ID from the authorization header
    const authHeader = req.headers.get('Authorization')?.split('Bearer ')[1]
    if (!authHeader) {
      throw new Error('No authorization header')
    }

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(authHeader)
    if (userError || !user) {
      throw new Error('Unauthorized')
    }

    // Create book access record using service role client
    const { error: accessError } = await supabaseClient
      .from('book_access')
      .insert({
        book_id: bookId,
        access_level: accessLevel,
        created_by: user.id,
        invited_email: email,
        status: 'pending'
      })

    if (accessError) throw accessError

    // Get book details
    const { data: book, error: bookError } = await supabaseClient
      .from('books')
      .select('name')
      .eq('id', bookId)
      .single()

    if (bookError) throw bookError

    // Send email using Mailgun
    const MAILGUN_API_KEY = Deno.env.get('MAILGUN_API_KEY')
    const MAILGUN_DOMAIN = Deno.env.get('MAILGUN_DOMAIN')
    
    if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
      throw new Error('Missing Mailgun configuration')
    }

    const mailgunEndpoint = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`
    const formData = new FormData()
    formData.append('from', `Book Collaboration <mailgun@${MAILGUN_DOMAIN}>`)
    formData.append('to', email)
    formData.append('subject', `You've been invited to collaborate on "${book.name}"`)
    formData.append('html', `
      <p>Hello,</p>
      <p>${user.email} has invited you to collaborate on their book "${book.name}" with ${accessLevel} access.</p>
      <p><a href="${Deno.env.get('PUBLIC_SITE_URL')}/book/${bookId}">View Book</a></p>
    `)

    const res = await fetch(mailgunEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}`,
      },
      body: formData,
    })

    if (!res.ok) {
      const errorData = await res.json()
      throw new Error(errorData.message || 'Failed to send email')
    }

    return new Response(JSON.stringify({ success: true }), {
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