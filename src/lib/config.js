/**
 * BotKorp Application Configuration
 * 
 * Update BACKEND_URL after deploying the Python backend to Cloud Run
 */

// Backend API Configuration
export const BACKEND_URL = 'https://botkorp-backend-695066639923.europe-west1.run.app';

// Feature Flags
export const FEATURES = {
  ENABLE_NOTIFICATIONS: true,
  ENABLE_ANALYTICS: true,
  ENABLE_PDF_GENERATION: true,
};

// API Endpoints
export const API = {
  CREATE_RENTAL_AGREEMENTS: `${BACKEND_URL}/api/create-rental-agreements`,  // Renamed: was GENERATE_AGREEMENT_PDF
  GENERATE_INVOICE_PDF: `${BACKEND_URL}/api/generate-invoice-pdf`,
  SEND_INVOICE_EMAIL: `${BACKEND_URL}/api/send-invoice-email`,
  // SEND_INSTALLATION_NOTIFICATION moved to Supabase Edge Function
  CREATE_SERVICE_AMENDMENT: `${BACKEND_URL}/api/create-service-amendment`,
  GET_PRICING: `${BACKEND_URL}/api/pricing`,
  CALCULATE_PRICING: `${BACKEND_URL}/api/calculate-pricing`,
  HEALTH_CHECK: `${BACKEND_URL}/health`,
};

// Default Configuration
export const CONFIG = {
  APP_NAME: 'BotKorp',
  APP_VERSION: '1.0.0',
  SUPPORT_EMAIL: 'support@botkorp.co.za',
  COMPANY_NAME: 'BotKorp (Pty) Ltd',
};

