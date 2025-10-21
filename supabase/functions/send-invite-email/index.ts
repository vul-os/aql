// Bot Korp - Send Member Invitation Email
// Supabase Edge Function using Resend API

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

interface InviteEmailRequest {
  invitation_id: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Beautiful HTML email template
function getEmailTemplate(data: InviteEmailRequest): string {
  const portalUrl = `${Deno.env.get('APP_URL') || 'https://app.botkorp.com'}/portal`
  const expiryDate = new Date(data.expires_at).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bot Korp Team Invitation</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      background: linear-gradient(135deg, #FF6B35 0%, #e05525 100%);
      padding: 40px 30px;
      text-align: center;
    }
    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .logo-icon {
      width: 48px;
      height: 48px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
    }
    .logo-text {
      font-size: 32px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.5px;
    }
    .header-subtitle {
      color: rgba(255, 255, 255, 0.9);
      font-size: 16px;
      margin: 0;
    }
    .content {
      padding: 40px 30px;
    }
    .greeting {
      font-size: 24px;
      font-weight: 600;
      color: #111827;
      margin: 0 0 20px 0;
    }
    .message {
      font-size: 16px;
      color: #4b5563;
      margin: 0 0 24px 0;
    }
    .invitation-card {
      background: #fef3f0;
      border: 2px solid #fed7cd;
      border-radius: 12px;
      padding: 24px;
      margin: 24px 0;
    }
    .invitation-card h3 {
      margin: 0 0 16px 0;
      font-size: 18px;
      color: #111827;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 500;
      color: #6b7280;
    }
    .detail-value {
      font-weight: 600;
      color: #111827;
      text-transform: capitalize;
    }
    .cta-button {
      display: inline-block;
      background: linear-gradient(135deg, #FF6B35 0%, #e05525 100%);
      color: #ffffff;
      text-decoration: none;
      padding: 16px 40px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      text-align: center;
      margin: 24px 0;
      box-shadow: 0 4px 6px rgba(255, 107, 53, 0.2);
      transition: transform 0.2s;
    }
    .cta-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 12px rgba(255, 107, 53, 0.3);
    }
    .secondary-link {
      color: #FF6B35;
      text-decoration: none;
      font-size: 14px;
      word-break: break-all;
    }
    .expiry-notice {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 16px;
      border-radius: 8px;
      margin: 24px 0;
    }
    .expiry-notice p {
      margin: 0;
      font-size: 14px;
      color: #92400e;
    }
    .features {
      margin: 32px 0;
    }
    .features h3 {
      font-size: 18px;
      color: #111827;
      margin: 0 0 16px 0;
    }
    .feature-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .feature-item {
      padding: 12px 0;
      display: flex;
      align-items: start;
      gap: 12px;
    }
    .feature-icon {
      width: 24px;
      height: 24px;
      background: #fed7cd;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .footer {
      background: #f9fafb;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e5e7eb;
    }
    .footer p {
      margin: 8px 0;
      font-size: 14px;
      color: #6b7280;
    }
    .footer-links {
      margin: 16px 0;
    }
    .footer-link {
      color: #FF6B35;
      text-decoration: none;
      margin: 0 12px;
      font-size: 14px;
    }
    @media only screen and (max-width: 600px) {
      .content {
        padding: 30px 20px;
      }
      .greeting {
        font-size: 20px;
      }
      .cta-button {
        display: block;
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="logo">
        <div class="logo-icon">🤖</div>
        <div class="logo-text">Bot Korp</div>
      </div>
      <p class="header-subtitle">Smart Property Automation</p>
    </div>

    <!-- Content -->
    <div class="content">
      <h1 class="greeting">You're Invited! 🎉</h1>
      
      <p class="message">
        <strong>${data.inviter_name}</strong> has invited you to join 
        <strong>${data.organization_name}</strong> on Bot Korp.
      </p>

      <!-- Invitation Details -->
      <div class="invitation-card">
        <h3>Invitation Details</h3>
        <div class="detail-row">
          <span class="detail-label">Organization:</span>
          <span class="detail-value">${data.organization_name}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Your Role:</span>
          <span class="detail-value">${data.role}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Invited By:</span>
          <span class="detail-value">${data.inviter_name}</span>
        </div>
      </div>

      <!-- Instructions -->
      <div class="expiry-notice">
        <p>
          <strong>To accept this invitation:</strong><br>
          Simply sign in to your account (or create one if you don't have one yet) using the email address <strong>${data.email}</strong>. 
          Your invitation will be automatically applied when you log in.
        </p>
      </div>

      <!-- CTA Button -->
      <center>
        <a href="${portalUrl}" class="cta-button">
          Sign In / Sign Up
        </a>
      </center>

      <!-- Alternative Link -->
      <p style="text-align: center; font-size: 14px; color: #6b7280;">
        Or copy and paste this link:<br>
        <a href="${portalUrl}" class="secondary-link">${portalUrl}</a>
      </p>

      <!-- Expiry Notice -->
      <div class="expiry-notice">
        <p>
          ⏰ <strong>This invitation expires on ${expiryDate}.</strong>
          Please sign in before then to join the team.
        </p>
      </div>

      <!-- Features -->
      <div class="features">
        <h3>What you'll get access to:</h3>
        <ul class="feature-list">
          <li class="feature-item">
            <div class="feature-icon">📊</div>
            <span>Real-time dashboard with bot analytics and monitoring</span>
          </li>
          <li class="feature-item">
            <div class="feature-icon">🤖</div>
            <span>Control and manage autonomous bots for lawn, pool, and security</span>
          </li>
          <li class="feature-item">
            <div class="feature-icon">📱</div>
            <span>Mobile-friendly interface accessible from anywhere</span>
          </li>
          <li class="feature-item">
            <div class="feature-icon">🔔</div>
            <span>Instant alerts and notifications for important events</span>
          </li>
          <li class="feature-item">
            <div class="feature-icon">👥</div>
            <span>Collaborate with team members on property management</span>
          </li>
        </ul>
      </div>

      <!-- Help Text -->
      <p class="message" style="margin-top: 32px;">
        If you have any questions or need assistance, feel free to reply to this email 
        or contact us at <a href="mailto:support@botkorp.com" style="color: #FF6B35;">support@botkorp.com</a>.
      </p>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p><strong>Bot Korp</strong> - Automated Property Management</p>
      <p>Smart bots for your property. Automated. Reliable. Efficient.</p>
      <div class="footer-links">
        <a href="https://botkorp.com" class="footer-link">Website</a>
        <a href="https://botkorp.com/docs" class="footer-link">Documentation</a>
        <a href="https://botkorp.com/support" class="footer-link">Support</a>
      </div>
      <p style="font-size: 12px; margin-top: 20px;">
        This invitation was sent to ${data.email}. If you weren't expecting this invitation,
        you can safely ignore this email.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim()
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate Resend API key
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured')
    }

    // Parse request body
    const { invitation_id }: InviteEmailRequest = await req.json()

    console.log('📧 Processing invitation:', invitation_id)
    
    // Validate invitation_id
    if (!invitation_id) {
      throw new Error('invitation_id is required')
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

    // Fetch invitation details from database
    const { data: invitation, error: inviteError } = await supabase
      .from('organization_invitations')
      .select(`
        *,
        organization:organizations!organization_id(name),
        inviter:profiles!invited_by(first_name, email)
      `)
      .eq('id', invitation_id)
      .single()

    if (inviteError || !invitation) {
      console.error('❌ Failed to fetch invitation:', inviteError)
      console.error('Error details:', JSON.stringify(inviteError, null, 2))
      throw new Error(`Invitation not found: ${inviteError?.message || 'Unknown error'}`)
    }

    console.log('✅ Invitation loaded:', invitation.email)
    console.log('Token value:', invitation.token)
    console.log('Full invitation:', JSON.stringify(invitation, null, 2))
    
    // Build invite data
    const inviteData = {
      invitation_id: invitation.id,
      email: invitation.email,
      organization_name: invitation.organization?.name || 'Unknown Organization',
      organization_id: invitation.organization_id,
      role: invitation.role,
      inviter_name: invitation.inviter?.first_name || 'Team',
      inviter_email: invitation.inviter?.email || 'noreply@botkorp.com',
      invite_token: invitation.token,
      expires_at: invitation.expires_at
    }
    
    console.log('📬 Sending email to:', inviteData.email)

    // Send email via Resend
    // Note: Using onboarding@resend.dev until botkorp.com domain is verified
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Bot Korp <notify@kom.botkorp.com>',
        to: inviteData.email,
        subject: `You're invited to join ${inviteData.organization_name} on Bot Korp`,
        html: getEmailTemplate(inviteData),
        reply_to: inviteData.inviter_email,
        tags: [
          { name: 'type', value: 'invitation' },
          { name: 'organization_id', value: inviteData.organization_id },
        ],
      }),
    })

    if (!emailResponse.ok) {
      const errorData = await emailResponse.text()
      console.error('❌ Resend API error:', errorData)
      console.error('Request body was:', JSON.stringify({
        from: 'Bot Korp <notify@kom.botkorp.com>',
        to: inviteData.email,
        subject: `You're invited to join ${inviteData.organization_name} on Bot Korp`,
      }))
      throw new Error(`Failed to send email: ${errorData}`)
    }

    const emailResult = await emailResponse.json()
    console.log('✅ Email sent successfully:', emailResult.id)

    // Update invitation metadata with email info
    await supabase
      .from('organization_invitations')
      .update({
        metadata: {
          ...(invitation.metadata || {}),
          email_sent_at: new Date().toISOString(),
          email_id: emailResult.id,
        }
      })
      .eq('id', invitation_id)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Invitation email sent successfully',
        email_id: emailResult.id,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error sending invite email:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

