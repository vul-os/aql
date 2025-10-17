"""
Configuration constants for BotKorp Backend API
Fill in the service keys before deployment
"""
import os

# ==================== BACKEND CONFIGURATION ====================

# Backend URL (update this after deploying to Cloud Run)
BACKEND_URL = os.environ.get('BACKEND_URL', 'http://localhost:8080')

# ==================== SUPABASE CONFIGURATION ====================

# Supabase URL and Service Role Key (server-side only, has full access)
# Get your service role key from: https://app.supabase.com/project/_/settings/api
# It should start with "eyJ" and be very long (JWT token)
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://kyoowsarfopltjwmhksi.supabase.co')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', 'REDACTED_JWT')

# ==================== RESEND EMAIL CONFIGURATION ====================

# Resend API Key for sending emails
RESEND_API_KEY = os.environ.get('RESEND_API_KEY', 're_HjE9aC37_P2q9RsQAr4F91i3cKHKEfwgN')

# ==================== ENVIRONMENT ====================

# Environment (development, staging, production)
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'development')

# Debug mode
DEBUG = os.environ.get('DEBUG', 'True').lower() == 'true'

# ==================== PRICING CONSTANTS ====================
# Note: Pricing is now fetched from database (pricing_structure table)
# These are fallback values only if database fetch fails

BILLING_DAY = 1  # Day of month for billing

