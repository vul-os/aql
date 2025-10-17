# Backend Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Install Dependencies
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Step 2: Configure Environment
```bash
cp .env.example .env
```

Edit `.env` and fill in:
```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc... (your service role key)
RESEND_API_KEY=re_xxxxx (your Resend API key)
```

**Where to find these:**
- Supabase URL & Key: Supabase Dashboard → Settings → API
- Resend API Key: https://resend.com/api-keys

### Step 3: Run the Server
```bash
python main.py
```

You should see:
```
 * Running on http://0.0.0.0:8080
```

### Step 4: Test It
```bash
curl http://localhost:8080/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "botkorp_backend",
  "version": "1.0.0"
}
```

### Step 5: Update Frontend
Edit `src/lib/config.js` (or create `.env` in project root):
```javascript
export const BACKEND_URL = 'http://localhost:8080';
```

Or create `.env`:
```env
VITE_BACKEND_URL=http://localhost:8080
```

## ✅ You're Ready!

Your backend is now running locally. Start your frontend with `npm run dev` and test the integration.

## 🌐 Deploy to Production

When you're ready to deploy:

```bash
./deploy.sh
```

This will:
1. Ask for your credentials
2. Deploy to Google Cloud Run
3. Give you the production URL

Then update your frontend config with the production URL and you're live!

## 📚 Need More Help?

- Full documentation: See `README.md`
- Complete migration guide: See `../BACKEND_MIGRATION_SUMMARY.md`
- Troubleshooting: Check README.md troubleshooting section

