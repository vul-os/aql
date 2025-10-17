# BotKorp Backend - Deployment Summary

## ✅ What We've Accomplished

### 1. Backend Deployed to Cloud Run
- **Service URL**: `https://botkorp-backend-695066639923.europe-west1.run.app`
- **Region**: europe-west1
- **Status**: ✅ Deployed and running

### 2. Environment Variables Set
- SUPABASE_URL: `https://zjaeljuzyuuaxprcfvrz.supabase.co`
- SUPABASE_SERVICE_KEY: ✅ Configured
- RESEND_API_KEY: `re_HjE9aC37_P2q9RsQAr4F91i3cKHKEfwgN`
- ENVIRONMENT: production
- DEBUG: False

### 3. Resend Email - REST API Implementation
- ✅ Removed `resend` Python package dependency
- ✅ Implemented REST API calls using `requests` library
- ✅ More lightweight and flexible

### 4. Database-Driven Pricing
- ✅ Removed hardcoded pricing constants
- ✅ Pricing now fetched from `pricing_structure` table
- ✅ Pricing data:
  - Bot Rental: R150.00/month
  - Service Fee: R143.75/visit
  - Setup Fee: R299.00/bot

### 5. New API Endpoints
- `GET /health` - Health check with Supabase status
- `GET /api/pricing?bot_type=mow_bot` - Get pricing from DB
- `POST /api/calculate-pricing` - Calculate total pricing
- `POST /api/generate-agreement-pdf` - Generate rental agreement
- `POST /api/generate-invoice-pdf` - Generate invoice
- `POST /api/send-invoice-email` - Send invoice via email

### 6. Frontend Integration
- ✅ Updated `src/lib/config.js` with API endpoints
- ✅ Updated `SimplePriceCalculator` to fetch pricing from backend
- ✅ Added loading states and fallback pricing

### 7. Deployment Scripts
- ✅ `deploy.sh` - Deploy to Cloud Run
- ✅ `run-local.sh` - Run backend locally for development

## 📋 Quick Commands

### Local Development
```bash
cd backend
./run-local.sh
```

### Test Endpoints
```bash
# Health check
curl http://localhost:8080/health

# Get pricing
curl "http://localhost:8080/api/pricing?bot_type=mow_bot"

# Calculate pricing
curl -X POST http://localhost:8080/api/calculate-pricing \
  -H "Content-Type: application/json" \
  -d '{"number_of_bots": 2, "services_per_month": 4, "bot_type": "mow_bot"}'
```

### Deploy to Cloud Run
```bash
cd backend
./deploy.sh
```

### Update Environment Variables
```bash
gcloud run services update botkorp-backend \
  --region europe-west1 \
  --update-env-vars="KEY=value"
```

## 🔧 Frontend Configuration

Update your frontend `.env` or use default:

```bash
VITE_BACKEND_URL=http://localhost:8080  # or Cloud Run URL
```

For local development, the frontend will automatically use `http://localhost:8080`

For production, update to: `https://botkorp-backend-695066639923.europe-west1.run.app`

## 📊 Pricing Structure

The system now uses database-driven pricing from the `pricing_structure` table:

| Bot Type | Rental (Monthly) | Service (Per Visit) | Setup Fee |
|----------|------------------|---------------------|-----------|
| mow_bot | R150.00 | R143.75 | R299.00 |
| pool_bot | R150.00 | R45.00 | R299.00 |
| security_bot | R200.00 | R0.00 | R399.00 |
| weather_station | R100.00 | R0.00 | R199.00 |

## 🚀 Next Steps

1. **Get Supabase Service Role Key** (if needed for local dev)
   - Go to: https://app.supabase.com/project/_/settings/api
   - Copy the "service_role" key (starts with `eyJ`)
   - Update `backend/config.py`

2. **Test Frontend with Backend**
   ```bash
   # Terminal 1: Run backend
   cd backend && ./run-local.sh
   
   # Terminal 2: Run frontend
   npm run dev
   ```

3. **Deploy Backend Changes**
   ```bash
   cd backend && ./deploy.sh
   ```

4. **Update Frontend Config for Production**
   - Set `VITE_BACKEND_URL=https://botkorp-backend-695066639923.europe-west1.run.app`
   - Deploy frontend to Firebase

## 📝 Files Created/Modified

### Created:
- `backend/deploy.sh` - Simplified deployment script
- `backend/run-local.sh` - Local development script
- `backend/SETUP_GUIDE.md` - Complete setup instructions
- `backend/get-supabase-key.md` - How to get Supabase key
- `backend/DEPLOYMENT_SUMMARY.md` - This file

### Modified:
- `backend/main.py` - REST API for Resend, DB pricing, new endpoints
- `backend/config.py` - Removed hardcoded pricing, added comments
- `backend/requirements.txt` - Removed resend package
- `backend/Dockerfile` - Fixed package name for Debian
- `src/lib/config.js` - Added pricing API endpoints
- `src/components/services/simple-price-calculator.jsx` - Fetch pricing from API

### Deleted:
- `backend/deploy-to-cloudrun.sh` - Replaced by deploy.sh

## 🔒 Security Notes

- Service Role Key has full database access - never commit to git
- Resend API key is for sending emails - keep secure
- Backend URL is public but endpoints validate requests
- All sensitive keys are in environment variables

## 🐛 Troubleshooting

See `backend/SETUP_GUIDE.md` for detailed troubleshooting steps.

