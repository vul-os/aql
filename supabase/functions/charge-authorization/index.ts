// =====================================================
// Paystack Charge Authorization Function
// Charges an existing card authorization
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

interface ChargeRequest {
  authorization_code: string;
  amount: number; // in Rands
  email: string;
  reference?: string;
  description?: string;
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
    const body: ChargeRequest = await req.json();
    const { 
      authorization_code, 
      amount, 
      email, 
      reference, 
      description = 'Subscription payment',
      metadata = {} 
    } = body;

    // Verify authorization belongs to user
    const { data: authorization, error: authCheckError } = await supabase
      .from('payment_authorizations')
      .select('*')
      .eq('authorization_code', authorization_code)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .single();

    if (authCheckError || !authorization) {
      throw new Error('Invalid or unauthorized payment method');
    }

    // Generate reference if not provided
    const txReference = reference || `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create payment record first
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        organization_id: authorization.organization_id,
        amount,
        currency: 'ZAR',
        status: 'processing',
        payment_method: 'paystack',
        payment_type: metadata.payment_type || 'subscription',
        description,
        paystack_reference: txReference,
        paystack_authorization_code: authorization_code,
        paystack_customer_code: authorization.customer_code,
        payer_email: email,
        metadata: {
          ...metadata,
          user_id: user.id,
          authorization_id: authorization.id,
        },
      })
      .select()
      .single();

    if (paymentError) {
      throw new Error('Failed to create payment record');
    }

    // Charge the authorization via Paystack
    const chargeResponse = await fetch('https://api.paystack.co/transaction/charge_authorization', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        authorization_code,
        email,
        amount: amount * 100, // Convert Rands to kobo
        currency: 'ZAR',
        reference: txReference,
        metadata: {
          ...metadata,
          user_id: user.id,
          payment_id: payment.id,
        },
      }),
    });

    const chargeData = await chargeResponse.json();

    // Log the transaction
    await supabase
      .from('payment_transaction_logs')
      .insert({
        payment_id: payment.id,
        authorization_id: authorization.id,
        reference: txReference,
        amount,
        currency: 'ZAR',
        status: chargeData.status ? 'success' : 'failed',
        paystack_transaction_id: chargeData.data?.id,
        gateway_response: chargeData.data?.gateway_response,
        channel: chargeData.data?.channel,
        request_payload: { authorization_code, amount, email },
        response_payload: chargeData,
      });

    if (!chargeData.status) {
      // Update payment as failed
      await supabase
        .from('payments')
        .update({
          status: 'failed',
          paystack_response: chargeData,
          gateway_response: chargeData.message,
        })
        .eq('id', payment.id);

      // Update authorization failed attempts
      await supabase.rpc('update_authorization_usage', {
        p_authorization_id: authorization.id,
        p_success: false,
      });

      throw new Error(chargeData.message || 'Payment failed');
    }

    // Update payment as completed
    await supabase
      .from('payments')
      .update({
        status: 'completed',
        paid_at: new Date().toISOString(),
        paystack_transaction_id: chargeData.data.id,
        paystack_response: chargeData.data,
        gateway_response: chargeData.data.gateway_response,
        channel: chargeData.data.channel,
      })
      .eq('id', payment.id);

    // Update authorization usage
    await supabase.rpc('update_authorization_usage', {
      p_authorization_id: authorization.id,
      p_success: true,
    });

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          payment_id: payment.id,
          reference: txReference,
          amount,
          status: 'completed',
          transaction: chargeData.data,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in charge-authorization:', error);
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

