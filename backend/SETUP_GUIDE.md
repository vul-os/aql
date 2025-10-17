# BotKorp Backend Setup Guide

## Prerequisites

- Python 3.10+
- Google Cloud Account (for deployment)
- Supabase Project
- Resend Account

## Environment Variables

You need to set these environment variables:

### Supabase Configuration

Get your Supabase credentials from: https://app.supabase.com/project/_/settings/api

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...  # Service Role Key (starts with eyJ)
```

⚠️ **Important**: Use the **Service Role** key, NOT the anon/public key!

### Resend API Key

Get from: https://resend.com/api-keys

```bash
RESEND_API_KEY=re_xxxxxxxxxxxxx
```

### Backend Configuration

```bash
BACKEND_URL=http://localhost:8080  # or your Cloud Run URL
ENVIRONMENT=development  # or production
DEBUG=True  # or False for production
PORT=8080
```

## Local Development

1. **Install dependencies:**
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Run locally:**
   ```bash
   ./run-local.sh
   ```

   Or manually:
   ```bash
   export PORT=8080
   export ENVIRONMENT=development
   export DEBUG=True
   python3 main.py
   ```

3. **Test the API:**
   ```bash
   curl http://localhost:8080/health
   curl http://localhost:8080/api/pricing?bot_type=mow_bot
   ```

## Deployment to Google Cloud Run

1. **Login to Google Cloud:**
   ```bash
   gcloud auth login
   gcloud config set project botkorp-za
   ```

2. **Enable required APIs:**
   ```bash
   gcloud services enable cloudbuild.googleapis.com run.googleapis.com
   ```

3. **Deploy:**
   ```bash
   ./deploy.sh
   ```

   Or manually:
   ```bash
   gcloud run deploy botkorp-backend \
     --source . \
     --region europe-west1 \
     --platform managed \
     --allow-unauthenticated \
     --memory 1Gi \
     --cpu 1 \
     --timeout 300
   ```

4. **Set environment variables (after first deployment):**
   ```bash
   gcloud run services update botkorp-backend \
     --region europe-west1 \
     --update-env-vars="
       SUPABASE_URL=https://zjaeljuzyuuaxprcfvrz.supabase.co,
       SUPABASE_SERVICE_KEY=your_service_role_key,
       RESEND_API_KEY=re_HjE9aC37_P2q9RsQAr4F91i3cKHKEfwgN,
       ENVIRONMENT=production,
       DEBUG=False"
   ```

## API Endpoints

### Health Check
```bash
GET /health
```

### Get Pricing
```bash
GET /api/pricing?bot_type=mow_bot
```

### Calculate Pricing
```bash
POST /api/calculate-pricing
Content-Type: application/json

{
  "number_of_bots": 2,
  "services_per_month": 4,
  "bot_type": "mow_bot"
}
```

### Generate Agreement PDF
```bash
POST /api/generate-agreement-pdf
Content-Type: application/json

{
  "user_id": "uuid",
  "organization_id": "uuid",
  "location_id": "uuid",
  "signature_base64": "data:image/png;base64,...",
  "number_of_bots": 2,
  "services_per_month": 4
}
```

### Generate Invoice PDF
```bash
POST /api/generate-invoice-pdf
Content-Type: application/json

{
  "invoice_id": "uuid"
}
```

### Send Invoice Email
```bash
POST /api/send-invoice-email
Content-Type: application/json

{
  "invoice_id": "uuid"
}
```

## Troubleshooting

### Invalid API Key Error

If you see `SupabaseException: Invalid API key`, check:

1. You're using the **Service Role** key (starts with `eyJ`), not the anon key
2. The key is complete and not truncated
3. Get it from: https://app.supabase.com/project/_/settings/api

### Pricing Not Loading

Check that your database has pricing data:

```sql
SELECT * FROM pricing_structure WHERE bot_type = 'mow_bot' AND is_active = true;
```

If empty, run the seed migration:
```bash
cd ../supabase/migrations
psql < 20251017134616_seed_data.sql
```

