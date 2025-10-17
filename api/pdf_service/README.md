# BotKorp PDF Service API

Python Flask API for generating PDFs (agreements and invoices) and sending them via email.

## Features

- **Generate Agreement PDFs**: Creates rental agreement PDFs with signatures
- **Generate Invoice PDFs**: Creates professional invoice PDFs
- **Email Invoices**: Sends invoices via email with PDF attachments
- **Supabase Integration**: Stores PDFs in Supabase Storage
- **WeasyPrint**: High-quality PDF generation from HTML

## Endpoints

### Health Check
```
GET /health
```

### Generate Agreement PDF
```
POST /api/generate-agreement-pdf

Body:
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
```
POST /api/generate-invoice-pdf

Body:
{
  "invoice_id": "uuid"
}
```

### Send Invoice Email
```
POST /api/send-invoice-email

Body:
{
  "invoice_id": "uuid"
}
```

## Local Development

### 1. Install Dependencies

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Set Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
RESEND_API_KEY=your_resend_key
```

### 3. Run Locally

```bash
python main.py
```

API will be available at `http://localhost:8080`

## Deployment

### Deploy to Google Cloud Run

```bash
# Build and deploy
gcloud run deploy botkorp-pdf-service \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars SUPABASE_URL=https://your-project.supabase.co \
  --set-env-vars SUPABASE_SERVICE_ROLE_KEY=your_key \
  --set-env-vars RESEND_API_KEY=your_key
```

### Deploy to AWS Lambda (using Zappa)

```bash
# Install Zappa
pip install zappa

# Initialize
zappa init

# Deploy
zappa deploy production
```

### Deploy to Heroku

```bash
# Create app
heroku create botkorp-pdf-service

# Set config vars
heroku config:set SUPABASE_URL=https://your-project.supabase.co
heroku config:set SUPABASE_SERVICE_ROLE_KEY=your_key
heroku config:set RESEND_API_KEY=your_key

# Deploy
git push heroku main
```

### Deploy with Docker

```bash
# Build image
docker build -t botkorp-pdf-service .

# Run locally
docker run -p 8080:8080 \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=your_key \
  -e RESEND_API_KEY=your_key \
  botkorp-pdf-service

# Push to registry and deploy
docker tag botkorp-pdf-service:latest your-registry/botkorp-pdf-service:latest
docker push your-registry/botkorp-pdf-service:latest
```

## Update Frontend to Use Python API

Replace the Deno Edge Function call in your frontend:

```javascript
// OLD: Call Deno Edge Function
const response = await fetch(
  `${supabaseUrl}/functions/v1/generate-agreement-pdf`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify(requestBody)
  }
);

// NEW: Call Python API
const response = await fetch(
  'https://your-api-url.com/api/generate-agreement-pdf',  // Your deployed URL
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody)
  }
);
```

## Benefits Over Deno Edge Functions

✅ **Better PDF Generation**: WeasyPrint produces professional PDFs
✅ **No External API Costs**: No PDFShift subscription needed
✅ **Email Integration**: Built-in email with attachments
✅ **Invoice Support**: Generate and email invoices automatically
✅ **Python Ecosystem**: Access to mature libraries
✅ **Easier Debugging**: Standard Python debugging tools
✅ **Template System**: Jinja2 templates for HTML

## Testing

```bash
# Test health endpoint
curl http://localhost:8080/health

# Test agreement generation
curl -X POST http://localhost:8080/api/generate-agreement-pdf \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "your-user-id",
    "organization_id": "your-org-id",
    "location_id": "your-location-id",
    "signature_base64": "data:image/png;base64,...",
    "number_of_bots": 2,
    "services_per_month": 4
  }'
```

## Architecture

```
Frontend (React)
    ↓ HTTP POST
Python API (Flask)
    ↓
├── Fetch data from Supabase DB
├── Calculate pricing (server-side)
├── Generate HTML from Jinja2 template
├── Convert HTML → PDF (WeasyPrint)
├── Upload PDF to Supabase Storage
├── Send email via Resend API
└── Return URLs to frontend
```

## License

Proprietary - BotKorp (Pty) Ltd

