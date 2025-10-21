# How to Get Your Supabase Service Role Key

## Steps:

1. **Go to your Supabase Dashboard:**
   https://app.supabase.com

2. **Select your project:**
   Click on "botkorp" or your project name

3. **Go to Settings → API:**
   https://app.supabase.com/project/_/settings/api

4. **Copy the Service Role Key:**
   - Look for "service_role" key (NOT "anon" key)
   - It will be a long JWT token starting with `eyJ...`
   - Click the copy button

5. **Update your config.py:**
   Replace `SUPABASE_SERVICE_KEY` value with the copied key

## The key should look like:
```
REDACTED_JWT
```

⚠️ **IMPORTANT**: This is a SECRET key with full database access. Never commit it to git!

