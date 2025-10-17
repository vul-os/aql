# 🔑 Get Your Supabase Service Role Key RIGHT NOW

## ⚠️ Your backend is running but needs a VALID key!

### Quick Steps (2 minutes):

1. **Open this URL in your browser:**
   ```
   https://app.supabase.com/project/zjaeljuzyuuaxprcfvrz/settings/api
   ```

2. **Find "service_role" key:**
   - Scroll down to "Project API keys"
   - Look for the row that says "service_role"
   - Click the eye icon to reveal it
   - Click the copy button

3. **The key will look like this:**
   ```
   REDACTED_JWT
   ```
   (It's a long string starting with `eyJ`)

4. **Update the config:**
   - Open: `backend/config.py`
   - Find line 18: `SUPABASE_SERVICE_KEY = ...`
   - Replace `'YOUR_SERVICE_ROLE_KEY_HERE_STARTS_WITH_eyJ'` with your copied key
   - Save the file

5. **Restart the backend:**
   ```bash
   # Stop current backend (Ctrl+C in the terminal running it)
   # OR
   pkill -f "python3 main.py"
   
   # Start again
   cd backend
   ./run-local.sh
   ```

6. **Test again in your browser!**

---

## ⚡ Alternative: Use Environment Variable (Better for security)

Instead of editing config.py, you can set the key as an environment variable:

```bash
export SUPABASE_SERVICE_KEY="eyJhbGci..."

cd backend
./run-local.sh
```

This way you don't commit the key to git!

