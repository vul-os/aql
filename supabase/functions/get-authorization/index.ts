// =====================================================
// Paystack Get Authorization Function
// Verifies card by charging R1 and stores authorization
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

interface AuthorizationRequest {
  email: string;
  amount?: number; // Default R1.00 (100 kobo)
  metadata?: Record<string, any>;
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
    const body: AuthorizationRequest = await req.json();
    const { email, amount = 100, metadata = {} } = body; // 100 kobo = R1.00

    // Get the origin from the request header to support localhost and production
    const origin = req.headers.get('origin') || 'https://botkorp.co.za';
    const callbackUrl = `${origin}/portal/billing`;

    // Initialize Paystack transaction
    const initResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount, // in kobo (100 kobo = R1)
        currency: 'ZAR',
        channels: ['card'],
        callback_url: callbackUrl,
        metadata: {
          ...metadata,
          user_id: user.id,
          purpose: 'card_verification',
          verification_amount: amount / 100,
        },
      }),
    });

    const initData = await initResponse.json();

    if (!initData.status) {
      throw new Error(initData.message || 'Failed to initialize transaction');
    }

    // Store pending transaction in database
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        organization_id: metadata.organization_id || null,
        amount: amount / 100, // Convert kobo to Rands
        currency: 'ZAR',
        status: 'pending',
        payment_method: 'paystack',
        payment_type: 'setup_fee',
        description: 'Card verification charge',
        paystack_reference: initData.data.reference,
        paystack_access_code: initData.data.access_code,
        payer_email: email,
        metadata: {
          user_id: user.id,
          purpose: 'card_verification',
        },
      })
      .select()
      .single();

    if (paymentError) {
      console.error('Error creating payment record:', paymentError);
    }

    // Return Paystack authorization URL and details
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          authorization_url: initData.data.authorization_url,
          access_code: initData.data.access_code,
          reference: initData.data.reference,
          payment_id: payment?.id,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in get-authorization:', error);
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

