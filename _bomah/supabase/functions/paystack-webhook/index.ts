// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

serve(async (req: Request) => {
	if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
	const signature = req.headers.get('x-paystack-signature')
	// TODO: verify signature with secret
	const payload = await req.json().catch(() => ({})) as any
	// TODO: handle events: charge.success, invoice.payment_failed, subscription.disable, refund.processed
	return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
}) 