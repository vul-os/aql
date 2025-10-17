#!/bin/bash
# Deploy BotKorp Backend to Google Cloud Run

set -e

PROJECT_ID="botkorp-za"
SERVICE_NAME="botkorp-backend"
REGION="europe-west1"

echo "🚀 Deploying $SERVICE_NAME to Cloud Run..."

gcloud run deploy $SERVICE_NAME \
    --source . \
    --project $PROJECT_ID \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --memory 1Gi \
    --cpu 1 \
    --timeout 300 \
    --max-instances 10 \
    --min-instances 0 \
    --port 8080

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Service URL: https://botkorp-backend-695066639923.europe-west1.run.app"

