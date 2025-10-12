// =====================================================
// Paystack Webhook Handler
// Handles Paystack webhook events
// =====================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts';

const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-paystack-signature',
};

// Verify Paystack webhook signature
async function verifySignature(body: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(PAYSTACK_SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const hash = Array.from(new Uint8Array(signed))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return hash === signature;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const signature = req.headers.get('x-paystack-signature');
    const body = await req.text();

    // Verify webhook signature
    if (!signature || !(await verifySignature(body, signature))) {
      console.error('Invalid webhook signature');
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid signature' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const event = JSON.parse(body);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log('Paystack webhook event:', event.event);

    // Handle different event types
    switch (event.event) {
      case 'charge.success': {
        await handleChargeSuccess(supabase, event.data);
        break;
      }

      case 'charge.failed': {
        await handleChargeFailed(supabase, event.data);
        break;
      }

      case 'transfer.success':
      case 'transfer.failed': {
        // Handle transfer events if needed
        console.log('Transfer event received:', event.event);
        break;
      }

      default:
        console.log('Unhandled event type:', event.event);
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

// Handle successful charge
async function handleChargeSuccess(supabase: any, data: any) {
  const reference = data.reference;
  
  console.log('Processing successful charge:', reference);

  // Update payment record
  const { error: updateError } = await supabase
    .from('payments')
    .update({
      status: 'completed',
      paid_at: new Date().toISOString(),
      paystack_transaction_id: data.id,
      paystack_response: data,
      gateway_response: data.gateway_response,
      channel: data.channel,
      card_type: data.authorization?.card_type,
      bank: data.authorization?.bank,
    })
    .eq('paystack_reference', reference);

  if (updateError) {
    console.error('Error updating payment:', updateError);
    throw updateError;
  }

  // If this was a verification charge, store the authorization
  if (data.metadata?.purpose === 'card_verification' && data.authorization) {
    const auth = data.authorization;
    const userId = data.metadata?.user_id;
    const organizationId = data.metadata?.organization_id;

    if (userId && auth.authorization_code) {
      // Check if authorization already exists
      const { data: existing } = await supabase
        .from('payment_authorizations')
        .select('id')
        .eq('authorization_code', auth.authorization_code)
        .single();

      if (!existing) {
        // Check if user has any other cards
        const { data: existingCards } = await supabase
          .from('payment_authorizations')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true)
          .is('deleted_at', null);

        const isFirstCard = !existingCards || existingCards.length === 0;

        // Create new authorization record
        const { error: authError } = await supabase
          .from('payment_authorizations')
          .insert({
            organization_id: organizationId,
            user_id: userId,
            authorization_code: auth.authorization_code,
            customer_code: data.customer?.customer_code || '',
            card_type: auth.card_type,
            last4: auth.last4,
            exp_month: auth.exp_month,
            exp_year: auth.exp_year,
            bin: auth.bin,
            bank: auth.bank,
            brand: auth.brand,
            country_code: auth.country_code || 'ZA',
            email: data.customer?.email,
            signature: auth.signature,
            channel: auth.channel,
            reusable: auth.reusable,
            verified_at: new Date().toISOString(),
            verification_amount: data.amount / 100,
            paystack_response: auth,
            is_active: true,
            is_default: isFirstCard, // Auto-set first card as default
            usage_count: 0,
          });

        if (authError) {
          console.error('Error storing authorization:', authError);
        } else {
          console.log(`Authorization stored successfully${isFirstCard ? ' (set as default)' : ''}`);
        }
      }
    }
  }

  // Log the transaction
  await supabase
    .from('payment_transaction_logs')
    .insert({
      reference,
      amount: data.amount / 100,
      currency: data.currency,
      status: 'success',
      paystack_transaction_id: data.id,
      gateway_response: data.gateway_response,
      channel: data.channel,
      response_payload: data,
    });

  console.log('Charge success handled:', reference);
}

// Handle failed charge
async function handleChargeFailed(supabase: any, data: any) {
  const reference = data.reference;
  
  console.log('Processing failed charge:', reference);

  // Update payment record
  const { error: updateError } = await supabase
    .from('payments')
    .update({
      status: 'failed',
      paystack_response: data,
      gateway_response: data.gateway_response,
    })
    .eq('paystack_reference', reference);

  if (updateError) {
    console.error('Error updating payment:', updateError);
  }

  // Log the transaction
  await supabase
    .from('payment_transaction_logs')
    .insert({
      reference,
      amount: data.amount / 100,
      currency: data.currency,
      status: 'failed',
      paystack_transaction_id: data.id,
      gateway_response: data.gateway_response,
      channel: data.channel,
      response_payload: data,
    });

  console.log('Charge failure handled:', reference);
}

