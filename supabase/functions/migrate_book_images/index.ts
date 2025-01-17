import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { bookId, isPublic } = await req.json()
    
    const sourceBucket = isPublic ? 'images' : 'public_images'
    const targetBucket = isPublic ? 'public_images' : 'images'
    
    // List all files in the source bucket for this book
    const { data: files, error: listError } = await supabase
      .storage
      .from(sourceBucket)
      .list(bookId.toString())

    if (listError) {
      throw listError
    }

    // For each file, download and upload to new bucket
    for (const file of files || []) {
      const filePath = `${bookId}/${file.name}`
      
      // Download file from source bucket
      const { data: fileData, error: downloadError } = await supabase
        .storage
        .from(sourceBucket)
        .download(filePath)

      if (downloadError) {
        console.error(`Error downloading ${filePath}:`, downloadError)
        continue
      }

      // Upload to target bucket
      const { error: uploadError } = await supabase
        .storage
        .from(targetBucket)
        .upload(filePath, fileData, {
          contentType: file.metadata?.mimetype || 'image/jpeg',
          upsert: true
        })

      if (uploadError) {
        console.error(`Error uploading ${filePath}:`, uploadError)
        continue
      }

      // Delete from source bucket
      const { error: deleteError } = await supabase
        .storage
        .from(sourceBucket)
        .remove([filePath])

      if (deleteError) {
        console.error(`Error deleting ${filePath}:`, deleteError)
      }
    }

    return new Response(
      JSON.stringify({ message: 'Images migrated successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})