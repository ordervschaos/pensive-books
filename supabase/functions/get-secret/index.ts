import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { secretNames } = await req.json()
    
    // Handle both single secret name and array of secret names
    const names = Array.isArray(secretNames) ? secretNames : [secretNames]
    
    // Get all requested secret values
    const secrets = names.reduce((acc, name) => {
      const value = Deno.env.get(name)
      if (!value) {
        throw new Error(`Secret ${name} not found`)
      }
      acc[name] = value
      return acc
    }, {})

    return new Response(
      JSON.stringify(secrets),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error) {
    console.error('Error in get-secret function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})