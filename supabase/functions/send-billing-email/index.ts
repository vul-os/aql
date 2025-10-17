// Supabase Edge Function: send-billing-email
// Sends billing notification emails via Resend
// Called by pg_cron via HTTP trigger

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const FROM_EMAIL = 'Bot Korp <billing@botkorp.co.za>';

interface BillingNotification {
  id: string;
  user_id: string;
  organization_id: string;
  invoice_id?: string;
  notification_type: string;
  recipients: string[];
  subject: string;
  body: string;
  html_body?: string;
}

serve(async (req) => {
  try {
    // Verify request is from Supabase
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.includes(SUPABASE_SERVICE_ROLE_KEY!)) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get pending notifications
    const { data: notifications, error: fetchError } = await supabase
      .from('billing_notifications')
      .select(`
        *,
        invoice:invoices(invoice_number, total_amount, due_date),
        user:profiles(email, first_name, surname)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);

    if (fetchError) {
      console.error('Error fetching notifications:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch notifications', details: fetchError }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Process each notification
    for (const notification of (notifications || []) as any[]) {
      try {
        // Get recipients (if not provided, use user email and org members)
        let recipients: string[] = notification.recipients || [];
        
        if (recipients.length === 0) {
          // Get all organization members' emails
          const { data: members } = await supabase
            .from('organization_members')
            .select('user:profiles(email)')
            .eq('organization_id', notification.organization_id)
            .eq('status', 'active');

          recipients = members?.map((m: any) => m.user?.email).filter(Boolean) || [];
        }

        if (recipients.length === 0) {
          recipients = [notification.user?.email].filter(Boolean);
        }

        // Generate HTML email body
        const htmlBody = notification.html_body || generateEmailHTML(notification);

        // Send via Resend
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: recipients,
            subject: notification.subject,
            html: htmlBody,
            text: notification.body,
          }),
        });

        const resendResponse = await response.json();
        results.processed++;

        if (response.ok && resendResponse.id) {
          // Email sent successfully
          await supabase
            .from('billing_notifications')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              resend_email_id: resendResponse.id,
              recipients: recipients,
              updated_at: new Date().toISOString(),
            })
            .eq('id', notification.id);

          results.successful++;
        } else {
          // Email failed
          await supabase
            .from('billing_notifications')
            .update({
              status: 'failed',
              error_message: resendResponse.message || JSON.stringify(resendResponse),
              updated_at: new Date().toISOString(),
            })
            .eq('id', notification.id);

          results.failed++;
        }
      } catch (error) {
        console.error(`Error sending notification ${notification.id}:`, error);
        results.errors.push(`${notification.id}: ${error.message}`);
        
        await supabase
          .from('billing_notifications')
          .update({
            status: 'failed',
            error_message: error.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', notification.id);
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

// Generate HTML email template
function generateEmailHTML(notification: any): string {
  const invoiceInfo = notification.invoice ? `
    <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 4px 0;"><strong>Invoice:</strong> ${notification.invoice.invoice_number}</p>
      <p style="margin: 4px 0;"><strong>Amount:</strong> R${parseFloat(notification.invoice.total_amount).toFixed(2)}</p>
      <p style="margin: 4px 0;"><strong>Due Date:</strong> ${new Date(notification.invoice.due_date).toLocaleDateString()}</p>
    </div>
  ` : '';

  const userName = notification.user?.first_name || 'Valued Customer';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${notification.subject}</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="margin: 0; font-size: 28px;">Bot Korp</h1>
        <p style="margin: 10px 0 0 0; opacity: 0.9;">Automated Property Care</p>
      </div>
      
      <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <h2 style="color: #667eea; margin-top: 0;">${notification.subject}</h2>
        
        <p>Hi ${userName},</p>
        
        <p>${notification.body}</p>
        
        ${invoiceInfo}
        
        <div style="margin: 30px 0;">
          <a href="https://botkorp.co.za/portal/billing" 
             style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View Billing Dashboard
          </a>
        </div>
        
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
        
        <p style="font-size: 14px; color: #666;">
          <strong>Need help?</strong><br>
          Contact us at <a href="mailto:support@botkorp.co.za" style="color: #667eea;">support@botkorp.co.za</a><br>
          or call us at +27 31 123 4567
        </p>
        
        <p style="font-size: 12px; color: #999; margin-top: 20px;">
          Bot Korp (Pty) Ltd | Durban, KwaZulu-Natal, South Africa<br>
          This is an automated message. Please do not reply directly to this email.
        </p>
      </div>
    </body>
    </html>
  `;
}

