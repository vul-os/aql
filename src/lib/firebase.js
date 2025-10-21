// Firebase configuration for BotKorp
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getMessaging } from "firebase/messaging";

/**
 * NEXT STEP: Get your VAPID key from Firebase Console
 * 
 * 1. Go to: https://console.firebase.google.com/project/botkorp-za/settings/cloudmessaging
 * 2. Scroll to "Web Push certificates"
 * 3. Click "Generate key pair" if you don't have one
 * 4. Copy the key (starts with BKx...)
 * 5. Add it to src/hooks/usePushNotifications.js line 136 (replace YOUR_VAPID_KEY_HERE)
 */

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "REDACTED_FIREBASE_KEY",
  authDomain: "botkorp-za.firebaseapp.com",
  projectId: "botkorp-za",
  storageBucket: "botkorp-za.firebasestorage.app",
  messagingSenderId: "695066639923",
  appId: "1:695066639923:web:61c02d57bbee2230f22d46",
  measurementId: "G-KM8CEB9V0C"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Analytics (optional)
let analytics = null;
if (typeof window !== 'undefined') {
  try {
    analytics = getAnalytics(app);
  } catch (error) {
    console.log('Analytics not available:', error);
  }
}

// Initialize Messaging
let messaging = null;
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  try {
    messaging = getMessaging(app);
  } catch (error) {
    console.log('Messaging not available:', error);
  }
}

export { app, analytics, messaging, firebaseConfig };

