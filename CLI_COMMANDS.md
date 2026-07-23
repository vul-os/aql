# 🚀 BotKorp - CLI Commands Quick Reference

Essential Supabase CLI commands for deploying and managing BotKorp.

## 📦 Storage Commands

```bash
# List all storage buckets
npx supabase storage list

# Create a new bucket
npx supabase storage create BUCKET_NAME --public false

# List files in a bucket
npx supabase storage ls BUCKET_NAME

# Download a file
npx supabase storage download BUCKET_NAME/path/to/file.pdf

# Upload a file
npx supabase storage upload BUCKET_NAME/path file.pdf

# Delete a file
npx supabase storage rm BUCKET_NAME/path/to/file.pdf

# Empty a bucket
npx supabase storage empty BUCKET_NAME
```

## ⚡ Edge Functions Commands

```bash
# List all functions
npx supabase functions list

# Create new function
npx supabase functions new FUNCTION_NAME

# Deploy a function
npx supabase functions deploy FUNCTION_NAME

# Deploy all functions
npx supabase functions deploy

# Serve function locally (for testing)
npx supabase functions serve FUNCTION_NAME

# View function logs (real-time)
npx supabase functions logs FUNCTION_NAME --follow

# View last 100 log entries
npx supabase functions logs FUNCTION_NAME --tail 100

# Invoke function (test in production)
npx supabase functions invoke FUNCTION_NAME --body '{"key":"value"}'

# Delete a function
npx supabase functions delete FUNCTION_NAME
```

## 🔐 Secrets Management

```bash
# List all secrets
npx supabase secrets list

# Set a secret
npx supabase secrets set SECRET_KEY=secret_value

# Set multiple secrets
npx supabase secrets set KEY1=value1 KEY2=value2

# Unset a secret
npx supabase secrets unset SECRET_KEY

# Set from file
npx supabase secrets set --env-file .env.production
```

## 🗄️ Database Commands

```bash
# Push all pending migrations to remote
npx supabase db push

# Pull remote schema changes
npx supabase db pull

# Reset local database
npx supabase db reset

# Create a new migration
npx supabase migration new MIGRATION_NAME

# List all migrations
npx supabase migration list

# Run migrations up to specific version
npx supabase db push --include-seed

# Generate migration from schema diff
npx supabase db diff -f MIGRATION_NAME

# Run SQL directly
npx supabase db execute --file path/to/file.sql
```

## 🔧 Project Management

```bash
# Link to remote project
npx supabase link --project-ref YOUR_PROJECT_REF

# Start local development
npx supabase start

# Stop local development
npx supabase stop

# Check status
npx supabase status

# Get project info
npx supabase projects list

# Get connection string
npx supabase db connection-string
```

## 🧪 Testing & Debugging

```bash
# Start local stack for testing
npx supabase start

# Run tests against local instance
npm test

# Tail logs locally
npx supabase logs --follow

# Debug specific function
npx supabase functions serve FUNCTION_NAME --debug

# Inspect database
npx supabase db inspect
```

## 🎯 BotKorp Specific Commands

### Initial Setup
```bash
# 1. Link project
npx supabase link --project-ref YOUR_REF

# 2. Apply all migrations
npx supabase db push

# 3. Deploy all functions
npx supabase functions deploy

# 4. Set required secrets
npx supabase secrets set \
  PDFSHIFT_API_KEY=your_key \
  RESEND_API_KEY=your_key \
  PAYSTACK_SECRET_KEY=your_key
```

### Deploy Storage & PDF Generation
```bash
# Apply storage migration
npx supabase db push

# Deploy PDF function
npx supabase functions deploy generate-agreement-pdf

# Set PDFShift key (if using)
npx supabase secrets set PDFSHIFT_API_KEY=pk_xxxxx

# Test locally
npx supabase functions serve generate-agreement-pdf
```

### Deploy Billing Functions
```bash
# Deploy all billing-related functions
npx supabase functions deploy charge-payment
npx supabase functions deploy send-billing-email
npx supabase functions deploy get-authorization
npx supabase functions deploy paystack-webhook

# View logs
npx supabase functions logs charge-payment --follow
```

### Monitoring & Logs
```bash
# View PDF generation logs
npx supabase functions logs generate-agreement-pdf --tail 50

# View billing logs
npx supabase functions logs charge-payment --tail 50

# View all function logs
npx supabase functions logs --tail 100

# Follow real-time logs
npx supabase functions logs --follow
```

### Storage Management
```bash
# List agreements
npx supabase storage ls agreements

# List signatures
npx supabase storage ls signatures

# List invoices
npx supabase storage ls invoices

# Check storage usage
npx supabase storage usage
```

### Database Queries
```bash
# Check rental agreements
npx supabase db execute --sql "SELECT * FROM rental_agreements LIMIT 5;"

# Check invoices
npx supabase db execute --sql "SELECT * FROM invoices ORDER BY created_at DESC LIMIT 10;"

# Check payment authorizations
npx supabase db execute --sql "SELECT * FROM payment_authorizations WHERE is_active = true;"
```

## 🔄 Common Workflows

### Deploy Everything
```bash
#!/bin/bash
# deploy-all.sh

echo "📦 Applying migrations..."
npx supabase db push

echo "⚡ Deploying functions..."
npx supabase functions deploy

echo "✅ Deployment complete!"
```

### Local Development
```bash
#!/bin/bash
# dev.sh

echo "🚀 Starting local Supabase..."
npx supabase start

echo "📡 Serving functions..."
npx supabase functions serve &

echo "💻 Starting frontend..."
npm run dev
```

### Check Health
```bash
#!/bin/bash
# check-health.sh

echo "📊 Project Status"
npx supabase status

echo ""
echo "📦 Storage Buckets"
npx supabase storage list

echo ""
echo "⚡ Functions"
npx supabase functions list

echo ""
echo "🗃️ Migrations"
npx supabase migration list
```

## 🆘 Troubleshooting Commands

```bash
# Reset everything locally
npx supabase db reset

# Re-link project
npx supabase link --project-ref YOUR_REF

# Check configuration
npx supabase status

# View error logs
npx supabase functions logs FUNCTION_NAME --tail 100

# Test function locally
npx supabase functions serve FUNCTION_NAME

# Verify database connection
npx supabase db connection-string

# Check storage policies
npx supabase storage list
```

## 📝 Environment Setup

```bash
# Install Supabase CLI globally
npm install -g supabase

# Or use with npx (no install needed)
npx supabase --version

# Login to Supabase
npx supabase login

# Logout
npx supabase logout
```

## 🔑 Getting Project Credentials

```bash
# Project URL
npx supabase status | grep API

# Service Role Key (keep secret!)
# Found in Supabase Dashboard > Settings > API

# Anon Key
# Found in Supabase Dashboard > Settings > API

# Connection String
npx supabase db connection-string
```

## 📚 Documentation Links

- Full CLI Reference: https://supabase.com/docs/reference/cli
- Storage Guide: https://supabase.com/docs/guides/storage
- Edge Functions: https://supabase.com/docs/guides/functions
- Database Migrations: https://supabase.com/docs/guides/cli/local-development

---

**Quick Deploy for BotKorp:**
```bash
# 1. Setup
npx supabase link --project-ref YOUR_REF

# 2. Database
npx supabase db push

# 3. Functions
npx supabase functions deploy

# 4. Secrets
npx supabase secrets set PDFSHIFT_API_KEY=xxx

# 5. Verify
npx supabase status
npx supabase functions list
npx supabase storage list

# Done! 🎉
```

