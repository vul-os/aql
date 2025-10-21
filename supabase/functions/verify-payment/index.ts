// =====================================================
// Paystack Verify Payment Function
// Verifies payment transaction and stores authorization
// Used for manual verification when webhooks don't work (localhost)
// =====================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VerifyRequest {
  reference: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Parse request body
    const body: VerifyRequest = await req.json();
    const { reference } = body;

    if (!reference) {
      throw new Error('Reference is required');
    }

    console.log('Verifying payment:', reference);

    // Verify transaction with Paystack
    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const verifyData = await verifyResponse.json();

    if (!verifyData.status || !verifyData.data) {
      throw new Error(verifyData.message || 'Payment verification failed');
    }

    const data = verifyData.data;

    console.log('Payment verified:', data.status);

    // Update payment record
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: data.status === 'success' ? 'completed' : 'failed',
        paid_at: data.paid_at || new Date().toISOString(),
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
    }

    // If this was a successful verification charge, store the authorization
    if (data.status === 'success' && data.metadata?.purpose === 'card_verification' && data.authorization) {
      const auth = data.authorization;
      const userId = data.metadata?.user_id || user.id;
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
              email: data.customer?.email || user.email,
              signature: auth.signature,
              channel: auth.channel,
              reusable: auth.reusable,
              verified_at: new Date().toISOString(),
              verification_amount: data.amount / 100,
              paystack_response: auth,
              is_active: true,
              is_default: isFirstCard,
              usage_count: 0,
            });

          if (authError) {
            console.error('Error storing authorization:', authError);
            throw new Error('Failed to store payment authorization');
          } else {
            console.log(`Authorization stored successfully${isFirstCard ? ' (set as default)' : ''}`);
          }
        } else {
          console.log('Authorization already exists');
        }
      }
    }

    // Return success
    return new Response(
      JSON.stringify({
        success: true,
        status: data.status,
        message: data.status === 'success' ? 'Payment verified successfully' : 'Payment failed',
        data: {
          reference: data.reference,
          amount: data.amount / 100,
          status: data.status,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in verify-payment:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});

