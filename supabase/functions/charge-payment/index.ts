// Supabase Edge Function: charge-payment
// Charges Paystack authorization for pending payment attempts
// Called by pg_cron via HTTP trigger

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

interface PaymentAttempt {
  id: string;
  invoice_id: string;
  authorization_code: string;
  amount: number;
  user_id: string;
  organization_id: string;
  attempt_number: number;
  retry_count: number;
}

interface PaystackChargeResponse {
  status: boolean;
  message: string;
  data?: {
    reference: string;
    status: string;
    amount: number;
    [key: string]: any;
  };
}

serve(async (req) => {
  try {
    // Verify request is from Supabase (check authorization header)
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.includes(SUPABASE_SERVICE_ROLE_KEY!)) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get all pending payment attempts
    const { data: attempts, error: fetchError } = await supabase
      .from('payment_attempts')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50); // Process 50 at a time

    if (fetchError) {
      console.error('Error fetching payment attempts:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch payment attempts', details: fetchError }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Process each payment attempt
    for (const attempt of (attempts || []) as PaymentAttempt[]) {
      try {
        // Call Paystack to charge the authorization
        const response = await fetch('https://api.paystack.co/transaction/charge_authorization', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            authorization_code: attempt.authorization_code,
            email: '', // Paystack will use the email associated with the authorization
            amount: Math.round(attempt.amount * 100), // Convert to kobo (cents)
            metadata: {
              invoice_id: attempt.invoice_id,
              payment_attempt_id: attempt.id,
              organization_id: attempt.organization_id,
              attempt_number: attempt.attempt_number,
            },
          }),
        });

        const paystackResponse: PaystackChargeResponse = await response.json();
        results.processed++;

        if (paystackResponse.status && paystackResponse.data?.status === 'success') {
          // Payment successful
          await supabase
            .from('payment_attempts')
            .update({
              status: 'success',
              paystack_reference: paystackResponse.data.reference,
              paystack_response: paystackResponse,
              updated_at: new Date().toISOString(),
            })
            .eq('id', attempt.id);

          // Mark invoice as paid
          await supabase.rpc('mark_invoice_paid', {
            p_invoice_id: attempt.invoice_id,
            p_amount: attempt.amount,
            p_payment_method: 'paystack',
            p_payment_reference: paystackResponse.data.reference,
          });

          // Create success notification
          await supabase
            .from('billing_notifications')
            .insert({
              invoice_id: attempt.invoice_id,
              payment_attempt_id: attempt.id,
              user_id: attempt.user_id,
              organization_id: attempt.organization_id,
              notification_type: 'payment_success',
              subject: 'Payment Received - Thank You!',
              body: `We've successfully received your payment of R${attempt.amount.toFixed(2)}. Reference: ${paystackResponse.data.reference}`,
              recipients: [], // Will be populated by email function
            });

          results.successful++;
        } else {
          // Payment failed
          const errorMessage = paystackResponse.message || 'Payment failed';

          await supabase
            .from('payment_attempts')
            .update({
              status: attempt.retry_count < 3 ? 'retry' : 'failed',
              paystack_response: paystackResponse,
              error_message: errorMessage,
              updated_at: new Date().toISOString(),
            })
            .eq('id', attempt.id);

          // Create failure notification
          await supabase
            .from('billing_notifications')
            .insert({
              invoice_id: attempt.invoice_id,
              payment_attempt_id: attempt.id,
              user_id: attempt.user_id,
              organization_id: attempt.organization_id,
              notification_type: 'payment_failed',
              subject: 'Payment Failed - Action Required',
              body: `Payment attempt failed: ${errorMessage}. We'll retry ${3 - attempt.retry_count} more time(s).`,
              recipients: [], // Will be populated by email function
            });

          results.failed++;
        }
      } catch (error) {
        console.error(`Error processing payment attempt ${attempt.id}:`, error);
        results.errors.push(`${attempt.id}: ${error.message}`);
        
        // Mark as failed but allow retry
        await supabase
          .from('payment_attempts')
          .update({
            status: 'retry',
            error_message: error.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', attempt.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

