# Send Invite Email - Supabase Edge Function

This Edge Function sends beautiful email invitations using the Resend API.

## Setup

### 1. Set up Resend API Key

Get your API key from [Resend Dashboard](https://resend.com/api-keys)

### 2. Configure Secrets

```bash
# Set the Resend API key as a secret
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx

# Set your app URL
supabase secrets set APP_URL=https://app.botkorp.com

# Service role key (should already be set)
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3. Deploy the Function

```bash
# Deploy the function
supabase functions deploy send-invite-email

# Test it locally first
supabase functions serve send-invite-email
```

### 4. Test the Function

```bash
curl -i --location --request POST 'http://localhost:54321/functions/v1/send-invite-email' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "invitation_id": "uuid-here",
    "email": "test@example.com",
    "organization_name": "Test Org",
    "organization_id": "uuid-here",
    "role": "member",
    "inviter_name": "John Doe",
    "inviter_email": "john@example.com",
    "invite_token": "test-token-123",
    "expires_at": "2024-12-31T23:59:59Z"
  }'
```

## Usage

This function is called automatically when a member invitation is created via the `create_member_invitation` SQL function.

### From Frontend

```javascript
// Create invitation
const { data: inviteData, error } = await supabase.rpc('create_member_invitation', {
  p_organization_id: orgId,
  p_email: 'newmember@example.com',
  p_role: 'member',
  p_invited_by: currentUserId,
  p_can_manage_bots: false,
  p_can_view_analytics: true
})

if (error) throw error

// Send email via Edge Function
const { data: emailResult, error: emailError } = await supabase.functions.invoke(
  'send-invite-email',
  { body: inviteData }
)
```

## Email Template Features

- ✅ Modern, responsive design
- ✅ Mobile-friendly
- ✅ Bot Korp branding
- ✅ Clear call-to-action button
- ✅ Invitation details card
- ✅ Expiry warning
- ✅ Feature highlights
- ✅ Alternative text link
- ✅ Support contact info

## Resend Configuration

### Sender Domain

To send from your own domain (e.g., `invites@botkorp.com`):

1. Add and verify your domain in Resend dashboard
2. Update the `from` field in the Edge Function
3. Configure DNS records as instructed by Resend

### Email Tracking

Resend automatically tracks:
- Delivery status
- Opens (if enabled)
- Clicks
- Bounces
- Complaints

View analytics in your Resend dashboard.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | Yes | Your Resend API key |
| `APP_URL` | Yes | Your app URL for invite links |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key for DB updates |

## Troubleshooting

### Email not sending

- Check that `RESEND_API_KEY` is set correctly
- Verify your Resend account is active
- Check function logs: `supabase functions logs send-invite-email`

### Email in spam

- Verify your sender domain in Resend
- Set up SPF, DKIM, and DMARC records
- Use a custom domain instead of the default

### Invite link not working

- Verify `APP_URL` environment variable is correct
- Check that the invite token is valid
- Ensure invitation hasn't expired (7 days default)

## Costs

Resend pricing (as of 2024):
- Free tier: 100 emails/day, 3,000 emails/month
- Pro tier: $20/month for 50,000 emails

See [Resend Pricing](https://resend.com/pricing) for current rates.

