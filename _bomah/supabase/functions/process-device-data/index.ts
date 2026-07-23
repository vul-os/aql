import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

serve(async (req) => {
	if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
	// TODO: validate and persist device data
	return new Response('ok', { status: 200 })
}) 