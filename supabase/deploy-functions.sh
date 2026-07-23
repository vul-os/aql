#!/bin/bash

# =====================================================
# Deploy All Supabase Edge Functions
# =====================================================

echo "🚀 Deploying BotKorp Edge Functions..."
echo ""

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found"
    echo "Install it with: npm install -g supabase"
    exit 1
fi

# Check if logged in
echo "📝 Checking Supabase login status..."
if ! supabase projects list &> /dev/null; then
    echo "❌ Not logged in to Supabase"
    echo "Run: supabase login"
    exit 1
fi

echo "✅ Logged in to Supabase"
echo ""

# Set secrets (if not already set)
echo "🔐 Setting secrets..."
echo "Note: You'll need to enter these manually if not set:"
echo "  - PAYSTACK_SECRET_KEY"
echo "  - PAYSTACK_PUBLIC_KEY"
echo ""

# Deploy functions
echo "📦 Deploying functions..."
echo ""

echo "1️⃣  Deploying get-authorization..."
supabase functions deploy get-authorization --no-verify-jwt

echo ""
echo "2️⃣  Deploying charge-authorization..."
supabase functions deploy charge-authorization --no-verify-jwt

echo ""
echo "3️⃣  Deploying paystack-webhook..."
supabase functions deploy paystack-webhook --no-verify-jwt

echo ""
echo "4️⃣  Deploying send-invite-email..."
supabase functions deploy send-invite-email --no-verify-jwt

echo ""
echo "✅ All functions deployed successfully!"
echo ""

# List deployed functions
echo "📋 Deployed functions:"
supabase functions list

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Set secrets: supabase secrets set PAYSTACK_SECRET_KEY=sk_test_..."
echo "2. Configure Paystack webhook: https://dashboard.paystack.com/settings/developer"
echo "3. Test the functions: supabase functions logs <function-name>"

