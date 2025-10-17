/**
 * BotKorp Application Configuration
 * 
 * Update BACKEND_URL after deploying the Python backend to Cloud Run
 */

// Backend API Configuration
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';

// Feature Flags
export const FEATURES = {
  ENABLE_NOTIFICATIONS: true,
  ENABLE_ANALYTICS: true,
  ENABLE_PDF_GENERATION: true,
};

// API Endpoints
export const API = {
  GENERATE_AGREEMENT_PDF: `${BACKEND_URL}/api/generate-agreement-pdf`,
  GENERATE_INVOICE_PDF: `${BACKEND_URL}/api/generate-invoice-pdf`,
  SEND_INVOICE_EMAIL: `${BACKEND_URL}/api/send-invoice-email`,
  SEND_INSTALLATION_NOTIFICATION: `${BACKEND_URL}/api/send-installation-notification`,
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

