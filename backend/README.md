# BotKorp Backend API

Python Flask backend for generating PDFs (agreements & invoices) and sending emails via Resend.

## 🚀 Quick Start - Local Development

### Prerequisites
- Python 3.11+
- pip

### Installation

1. **Create a virtual environment:**
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. **Install dependencies:**
```bash
pip install -r requirements.txt
```

3. **Create `.env` file:**
```bash
cp .env.example .env
```

4. **Fill in your environment variables in `.env`:**
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key-here
RESEND_API_KEY=re_your_resend_api_key_here
```

5. **Run the local server:**
```bash
python main.py
```

The server will start at `http://localhost:8080`

### Test the API

**Health Check:**
```bash
curl http://localhost:8080/health
```

**Generate Agreement PDF:**
```bash
curl -X POST http://localhost:8080/api/generate-agreement-pdf \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "uuid-here",
    "organization_id": "uuid-here",
    "location_id": "uuid-here",
    "signature_base64": "data:image/png;base64,...",
    "number_of_bots": 2,
    "services_per_month": 4
  }'
```

**Generate Invoice PDF:**
```bash
curl -X POST http://localhost:8080/api/generate-invoice-pdf \
  -H "Content-Type: application/json" \
  -d '{"invoice_id": "uuid-here"}'
```

## 🌐 Cloud Run Deployment

### Prerequisites
- Google Cloud SDK installed
- Google Cloud project created
- Billing enabled

### Deploy Steps

1. **Authenticate with Google Cloud:**
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

2. **Build and deploy to Cloud Run:**
```bash
# From the backend directory
gcloud run deploy botkorp-backend \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars SUPABASE_URL=your-url,SUPABASE_SERVICE_KEY=your-key,RESEND_API_KEY=your-key
```

3. **Get the service URL:**
```bash
gcloud run services describe botkorp-backend --region us-central1 --format 'value(status.url)'
```

4. **Update frontend configuration:**
   - Copy the Cloud Run URL
   - Update `src/lib/config.js` with the new `BACKEND_URL`

### Alternative: Deploy with Environment Variables from .env

```bash
gcloud run deploy botkorp-backend \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --env-vars-file .env.yaml
```

Create `.env.yaml`:
```yaml
SUPABASE_URL: "https://your-project.supabase.co"
SUPABASE_SERVICE_KEY: "your-service-role-key"
RESEND_API_KEY: "re_your_resend_api_key"
ENVIRONMENT: "production"
DEBUG: "False"
```

## 📁 Project Structure

```
backend/
├── main.py              # Flask application with all endpoints
├── config.py            # Configuration constants
├── requirements.txt     # Python dependencies
├── Dockerfile          # Container configuration
├── .env.example        # Example environment variables
├── .gitignore          # Git ignore patterns
├── README.md           # This file
└── templates/          # PDF templates
    ├── __init__.py
    ├── agreement.py    # Agreement PDF template
    └── invoice.py      # Invoice PDF template
```

## 🔌 API Endpoints

### `GET /health`
Health check endpoint

**Response:**
```json
{
  "status": "healthy",
  "service": "botkorp_backend",
  "version": "1.0.0",
  "timestamp": "2024-01-01T12:00:00"
}
```

### `POST /api/generate-agreement-pdf`
Generate a rental agreement PDF and save to Supabase Storage

**Request Body:**
```json
{
  "user_id": "uuid",
  "organization_id": "uuid",
  "location_id": "uuid",
  "signature_base64": "data:image/png;base64,...",
  "number_of_bots": 2,
  "services_per_month": 4
}
```

**Response:**
```json
{
  "success": true,
  "rental_agreement_id": "uuid",
  "signature_url": "https://...",
  "pdf_url": "https://...",
  "signature_path": "user_id/agreement_id_signature.png",
  "pdf_path": "user_id/agreement_id_agreement.pdf"
}
```

### `POST /api/generate-invoice-pdf`
Generate an invoice PDF and save to Supabase Storage

**Request Body:**
```json
{
  "invoice_id": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "invoice_id": "uuid",
  "pdf_url": "https://...",
  "pdf_path": "user_id/invoice_id.pdf"
}
```

### `POST /api/send-invoice-email`
Generate invoice PDF and send via email using Resend

**Request Body:**
```json
{
  "invoice_id": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "invoice_id": "uuid",
  "pdf_url": "https://...",
  "email_sent": true,
  "email_id": "resend-email-id"
}
```

## 🔑 Configuration

All configuration is in `config.py`. Key constants:

- `BACKEND_URL` - Backend API URL (update after deployment)
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Supabase service role key (server-side only)
- `RESEND_API_KEY` - Resend email API key
- `BOT_RENTAL_FEE` - Monthly bot rental fee (R150)
- `SERVICE_FEE` - Per-service visit fee (R150)
- `DEPOSIT_PER_BOT` - Refundable deposit per bot (R500)

## 🔧 Development

### Install development dependencies
```bash
pip install -r requirements.txt
```

### Run with auto-reload
```bash
export FLASK_ENV=development
python main.py
```

### Test PDF generation locally
The server includes CORS support for testing from the frontend.

## 📦 Docker

### Build locally
```bash
docker build -t botkorp-backend .
```

### Run locally
```bash
docker run -p 8080:8080 \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_SERVICE_KEY=your-key \
  -e RESEND_API_KEY=your-key \
  botkorp-backend
```

## 🐛 Troubleshooting

### WeasyPrint errors
If you get WeasyPrint rendering errors, ensure system dependencies are installed:

**Ubuntu/Debian:**
```bash
sudo apt-get install -y libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0
```

**macOS:**
```bash
brew install cairo pango gdk-pixbuf libffi
```

### Supabase connection errors
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are correct
- Make sure you're using the **service role key**, not the anon key
- Check that Supabase storage buckets exist: `signatures`, `agreements`, `invoices`

### Resend email errors
- Verify `RESEND_API_KEY` is valid
- Check that sender email is verified in Resend dashboard
- Ensure sending domain is configured

## 📝 Notes

- **Service Role Key Security**: The service role key bypasses RLS policies. Never expose it in frontend code.
- **CORS**: Enabled for all origins in development. Restrict in production if needed.
- **PDF Generation**: Uses WeasyPrint for HTML-to-PDF conversion
- **Storage**: PDFs and signatures saved to Supabase Storage buckets
- **Email**: Sent via Resend API with PDF attachments

## 🚧 TODO

- [ ] Add rate limiting
- [ ] Add API authentication/authorization
- [ ] Add request logging and monitoring
- [ ] Add unit tests
- [ ] Set up CI/CD pipeline

