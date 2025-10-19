// Bot Korp - Unified Notifications Handler
// Handles ALL notification types (email, push, etc.) triggered by database events

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const APP_URL = Deno.env.get('APP_URL') || 'https://app.botkorp.com'

interface NotificationRequest {
  type: string // bot_offline, bot_low_battery, service_completed, etc.
  user_ids: string[] // Array of user IDs to notify
  title: string
  message: string
  priority?: string // low, normal, high, urgent
  data?: any // Additional data
  send_email?: boolean
  send_push?: boolean
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Email templates for different notification types
function getEmailTemplate(notification: NotificationRequest, userName: string): string {
  const { type, title, message, data } = notification
  
  // Determine header color based on priority
  let headerGradient = 'linear-gradient(135deg, #FF6B35 0%, #e05525 100%)' // default orange
  let headerEmoji = '🔔'
  
  if (notification.priority === 'urgent') {
    headerGradient = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' // red
    headerEmoji = '🚨'
  } else if (notification.priority === 'high') {
    headerGradient = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' // amber
    headerEmoji = '⚠️'
  } else if (type.includes('success') || type.includes('completed')) {
    headerGradient = 'linear-gradient(135deg, #10b981 0%, #059669 100%)' // green
    headerEmoji = '✅'
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
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
      background: ${headerGradient};
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
      font-size: 18px;
      margin: 0;
      font-weight: 600;
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
      line-height: 1.6;
    }
    .alert-box {
      background: #fef3f0;
      border-left: 4px solid #FF6B35;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }
    .alert-box.urgent {
      background: #fef2f2;
      border-color: #ef4444;
    }
    .alert-box.high {
      background: #fffbeb;
      border-color: #f59e0b;
    }
    .cta-button {
      display: inline-block;
      background: ${headerGradient};
      color: #ffffff;
      text-decoration: none;
      padding: 16px 40px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      text-align: center;
      margin: 24px 0;
      box-shadow: 0 4px 6px rgba(255, 107, 53, 0.2);
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
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">
        <div class="logo-icon">🤖</div>
        <div class="logo-text">Bot Korp</div>
      </div>
      <p class="header-subtitle">${headerEmoji} ${type.replace(/_/g, ' ').toUpperCase()}</p>
    </div>

    <div class="content">
      <h1 class="greeting">Hi ${userName},</h1>
      
      <div class="alert-box ${notification.priority || ''}">
        <h2 style="margin: 0 0 12px 0; font-size: 18px; color: #111827;">${title}</h2>
        <p style="margin: 0; color: #4b5563; font-size: 15px;">${message}</p>
      </div>

      ${data?.action_url ? `
      <center>
        <a href="${APP_URL}${data.action_url}" class="cta-button">
          ${data.action_label || 'View Details'}
        </a>
      </center>
      ` : ''}

      <p class="message" style="margin-top: 32px;">
        You can manage your notification preferences in your 
        <a href="${APP_URL}/portal/settings?tab=notifications" style="color: #FF6B35; text-decoration: none;">account settings</a>.
      </p>
    </div>

    <div class="footer">
      <p><strong>Bot Korp</strong> - Automated Property Management</p>
      <p style="font-size: 12px; margin-top: 20px;">
        <a href="${APP_URL}/portal" style="color: #FF6B35; text-decoration: none;">Visit Portal</a> • 
        <a href="mailto:support@botkorp.com" style="color: #FF6B35; text-decoration: none;">Support</a>
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
    console.log(`═══════════════════════════════════════════════════════`)
    console.log(`🚀 NOTIFICATION FUNCTION INVOKED`)
    console.log(`   Time: ${new Date().toISOString()}`)
    console.log(`   Method: ${req.method}`)
    console.log(`═══════════════════════════════════════════════════════`)
    
    // Validate API keys
    console.log(`🔑 Environment Check:`)
    console.log(`   RESEND_API_KEY: ${RESEND_API_KEY ? `✅ Set (${RESEND_API_KEY.substring(0, 10)}...${RESEND_API_KEY.substring(RESEND_API_KEY.length - 4)})` : '❌ NOT SET'}`)
    console.log(`   SUPABASE_URL: ${SUPABASE_URL ? '✅ Set' : '❌ NOT SET'}`)
    console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ NOT SET'}`)
    console.log(`   APP_URL: ${APP_URL}`)
    
    if (!RESEND_API_KEY) {
      console.error(`❌ CRITICAL: RESEND_API_KEY is not configured`)
      throw new Error('RESEND_API_KEY is not configured')
    }

    // Parse request body
    const notificationReq: NotificationRequest = await req.json()
    const { type, user_ids, title, message, send_email = true, send_push = false } = notificationReq

    console.log(`\n📬 Notification Request Details:`)
    console.log(`   Type: ${type}`)
    console.log(`   Title: ${title}`)
    console.log(`   Message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`)
    console.log(`   User IDs: ${user_ids?.length || 0} user(s)`)
    console.log(`   Send Email: ${send_email}`)
    console.log(`   Send Push: ${send_push}`)
    console.log(`   Priority: ${notificationReq.priority || 'normal'}`)
    console.log(`📋 User IDs:`, user_ids)

    // Validate user_ids
    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      console.warn(`⚠️  No user IDs provided for ${type} notification`)
      return new Response(
        JSON.stringify({
          success: true,
          emails_sent: 0,
          push_sent: 0,
          total_users: 0,
          message: 'No users to notify'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    // Filter out null/undefined user_ids
    const validUserIds = user_ids.filter(id => id != null)
    if (validUserIds.length === 0) {
      console.warn(`⚠️  All user IDs were null/undefined for ${type} notification`)
      return new Response(
        JSON.stringify({
          success: true,
          emails_sent: 0,
          push_sent: 0,
          total_users: 0,
          message: 'No valid user IDs to notify'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

    // Get user details and preferences
    const { data: users, error: usersError } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', validUserIds)

    if (usersError) {
      console.error('❌ Error fetching users:', usersError)
      throw new Error(`Failed to fetch users: ${usersError.message}`)
    }

    if (!users || users.length === 0) {
      console.warn(`⚠️  No profiles found for user IDs:`, validUserIds)
      console.warn(`⚠️  This might indicate orphaned organization_members records`)
      return new Response(
        JSON.stringify({
          success: true,
          emails_sent: 0,
          push_sent: 0,
          total_users: 0,
          message: 'No user profiles found - possible data inconsistency'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    console.log(`✅ Found ${users.length} user profile(s)`)

    // Get notification preferences for each user
    const { data: preferences } = await supabase
      .from('notification_preferences')
      .select('*')
      .in('user_id', user_ids)

    const prefsMap = new Map(preferences?.map(p => [p.user_id, p]) || [])

    let emailsSent = 0
    let pushSent = 0

    // Process each user
    for (const user of users) {
      const prefs = prefsMap.get(user.id)
      
      // Check if user wants this type of notification via email
      const shouldSendEmail = send_email && prefs?.email_enabled !== false && (
        (type.includes('bot_') && prefs?.email_bot_alerts !== false) ||
        (type.includes('service_') && prefs?.email_service_reminders !== false) ||
        (type.includes('payment_') && prefs?.email_billing !== false) ||
        (type.includes('amendment_') && prefs?.email_service_reminders !== false) ||
        true // Default to true if no specific preference
      )

      if (shouldSendEmail && user.email) {
        try {
          const userName = user.full_name || 'there'
          
          console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
          console.log(`📧 SENDING EMAIL`)
          console.log(`   To: ${user.email}`)
          console.log(`   User ID: ${user.id}`)
          console.log(`   User Name: ${userName}`)
          console.log(`   Notification Type: ${type}`)
          console.log(`   Subject: ${title}`)
          console.log(`   Priority: ${notificationReq.priority || 'normal'}`)
          
          // Validate email format
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
          if (!emailRegex.test(user.email)) {
            console.error(`❌ Invalid email format: ${user.email}`)
            throw new Error(`Invalid email format: ${user.email}`)
          }
          
          const emailPayload = {
            from: 'Bot Korp <notify@kom.botkorp.com>',
            to: [user.email],
            subject: title,
            html: getEmailTemplate(notificationReq, userName),
            reply_to: 'support@botkorp.com',
            tags: [
              { name: 'type', value: type },
              { name: 'user_id', value: user.id },
            ],
          }
          
          console.log(`📦 Email Payload:`)
          console.log(`   From: ${emailPayload.from}`)
          console.log(`   To: ${emailPayload.to}`)
          console.log(`   Reply-To: ${emailPayload.reply_to}`)
          console.log(`   Tags: ${JSON.stringify(emailPayload.tags)}`)
          console.log(`   HTML Length: ${emailPayload.html.length} chars`)
          console.log(`   RESEND_API_KEY: ${RESEND_API_KEY ? `${RESEND_API_KEY.substring(0, 10)}...${RESEND_API_KEY.substring(RESEND_API_KEY.length - 4)}` : '❌ NOT SET'}`)
          
          // Send email via Resend
          console.log(`🌐 Making request to Resend API...`)
          const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(emailPayload),
          })

          console.log(`📡 Resend API Response Status: ${emailResponse.status} ${emailResponse.statusText}`)
          
          const responseData = await emailResponse.json()
          
          if (emailResponse.ok) {
            emailsSent++
            console.log(`✅ EMAIL SENT SUCCESSFULLY`)
            console.log(`   Email ID: ${responseData.id || 'N/A'}`)
            console.log(`   Full Response:`, JSON.stringify(responseData, null, 2))
          } else {
            console.error(`❌ EMAIL SEND FAILED`)
            console.error(`   Status: ${emailResponse.status} ${emailResponse.statusText}`)
            console.error(`   Response Body:`, JSON.stringify(responseData, null, 2))
            
            // Parse specific Resend error types
            if (responseData.message) {
              console.error(`   Error Message: ${responseData.message}`)
            }
            if (responseData.name) {
              console.error(`   Error Type: ${responseData.name}`)
            }
            
            // Common Resend errors
            if (emailResponse.status === 401) {
              console.error(`   ⚠️  Authentication failed - check RESEND_API_KEY`)
            } else if (emailResponse.status === 403) {
              console.error(`   ⚠️  Forbidden - sender email may not be verified in Resend`)
              console.error(`   ⚠️  Go to Resend Dashboard and verify: notify@kom.botkorp.com`)
              console.error(`   ⚠️  Or verify domain: kom.botkorp.com`)
            } else if (emailResponse.status === 422) {
              console.error(`   ⚠️  Validation error - check email payload structure`)
            } else if (emailResponse.status === 429) {
              console.error(`   ⚠️  Rate limit exceeded`)
            }
          }
          console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
        } catch (emailError) {
          console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
          console.error(`💥 EXCEPTION WHILE SENDING EMAIL`)
          console.error(`   To: ${user.email}`)
          console.error(`   Error Type: ${emailError?.constructor?.name || 'Unknown'}`)
          console.error(`   Error Message: ${emailError?.message || 'No message'}`)
          console.error(`   Error Stack:`)
          console.error(emailError?.stack || 'No stack trace')
          if (emailError?.cause) {
            console.error(`   Error Cause:`, emailError.cause)
          }
          console.error(`   Full Error:`, JSON.stringify(emailError, Object.getOwnPropertyNames(emailError), 2))
          console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
        }
      } else {
        if (!user.email) {
          console.warn(`⚠️  User ${user.id} has no email address`)
        } else if (!shouldSendEmail) {
          console.log(`🔕 Email skipped for ${user.email} - disabled in preferences or send_email=false`)
        }
      }

      // Create notification in database for in-app display
      // This happens regardless of send_push flag - we always want in-app notifications
      try {
        await supabase.from('notifications').insert({
          user_id: user.id,
          type,
          title,
          message,
          priority: notificationReq.priority || 'normal',
          data: notificationReq.data || {},
          action_url: notificationReq.data?.action_url || null,
          sent_push: false,
          sent_email: shouldSendEmail,
        })
        
        // TODO: Implement actual push notifications via Firebase/OneSignal
        if (send_push) {
          pushSent++
        }
      } catch (dbError) {
        console.error(`Error creating notification for ${user.id}:`, dbError)
      }
    }

    console.log(`✅ Notifications processed: ${emailsSent} emails, ${pushSent} push`)

    return new Response(
      JSON.stringify({
        success: true,
        emails_sent: emailsSent,
        push_sent: pushSent,
        total_users: users.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('❌ Error processing notifications:', error)
    
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

