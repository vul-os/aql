import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// Utility functions
function getBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Edge')) return 'Edge';
  return 'Unknown';
}

function getOS() {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iOS')) return 'iOS';
  return 'Unknown';
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function usePushNotifications() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscription, setSubscription] = useState(null);

  useEffect(() => {
    // Check if notifications are supported
    const supported = 'Notification' in window && 'serviceWorker' in navigator;
    setIsSupported(supported);

    if (supported) {
      checkExistingSubscription();
    }
  }, []);

  const checkExistingSubscription = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error checking subscription:', error);
        return;
      }

      setIsSubscribed(!!data);
      setSubscription(data);
    } catch (error) {
      console.error('Error checking existing subscription:', error);
    }
  };

  // Request permission
  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      alert('Push notifications are not supported in your browser');
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result === 'granted') {
        // Try Firebase first, fall back to Web Push if not available
        try {
          await subscribeWithFirebase();
        } catch (error) {
          console.log('Firebase not available, falling back to Web Push:', error);
          await subscribeWithWebPush();
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }, [isSupported]);

  // Subscribe with Firebase (if configured)
  const subscribeWithFirebase = async () => {
    try {
      // Import Firebase from our config
      const { getToken, onMessage } = await import('firebase/messaging');
      const { messaging } = await import('@/lib/firebase');

      if (!messaging) {
        throw new Error('Firebase messaging not available');
      }
      
      // Register service worker
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      
      // Get FCM token
      const token = await getToken(messaging, {
        vapidKey: 'BN1LuVyl2Qx01q-KD1zuByty76UymEImZS9exH0iInegntnA8ewT_du43uQaEm2z5FXBTqElmhjl5HxrCe7L2gs',
        serviceWorkerRegistration: registration
      });

      // Save to database
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('push_subscriptions')
        .upsert({
          user_id: user.id,
          endpoint: token,
          fcm_token: token,
          p256dh_key: 'firebase',
          auth_key: 'firebase',
          user_agent: navigator.userAgent,
          browser: getBrowser(),
          os: getOS(),
          is_active: true
        }, {
          onConflict: 'endpoint'
        })
        .select()
        .single();

      if (error) throw error;

      setSubscription(data);
      setIsSubscribed(true);

      // Handle foreground messages
      onMessage(messaging, (payload) => {
        console.log('Message received:', payload);
        
        // Show notification
        if (Notification.permission === 'granted') {
          new Notification(payload.notification.title, {
            body: payload.notification.body,
            icon: '/icon.png',
            badge: '/icon.png',
            data: payload.data
          });
        }
      });

      return token;
    } catch (error) {
      console.error('Error subscribing with Firebase:', error);
      throw error;
    }
  };

  // Subscribe with native Web Push (fallback if Firebase not available)
  const subscribeWithWebPush = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      
      // You'll need to generate VAPID keys for native push
      // Run: npx web-push generate-vapid-keys
      const vapidPublicKey = 'YOUR_VAPID_PUBLIC_KEY_HERE'; // Replace with your public VAPID key
      
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

      // Save to database
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('push_subscriptions')
        .upsert({
          user_id: user.id,
          endpoint: sub.endpoint,
          p256dh_key: arrayBufferToBase64(sub.getKey('p256dh')),
          auth_key: arrayBufferToBase64(sub.getKey('auth')),
          user_agent: navigator.userAgent,
          browser: getBrowser(),
          os: getOS(),
          is_active: true
        }, {
          onConflict: 'endpoint'
        })
        .select()
        .single();

      if (error) throw error;

      setSubscription(data);
      setIsSubscribed(true);
      return sub;
    } catch (error) {
      console.error('Error subscribing with native Web Push:', error);
      throw error;
    }
  };

  // Unsubscribe
  const unsubscribe = useCallback(async () => {
    try {
      if (subscription) {
        const { error } = await supabase
          .from('push_subscriptions')
          .update({ is_active: false })
          .eq('id', subscription.id);

        if (error) throw error;
        
        setSubscription(null);
        setIsSubscribed(false);
      }
    } catch (error) {
      console.error('Error unsubscribing:', error);
    }
  }, [subscription]);

  return {
    permission,
    isSupported,
    isSubscribed,
    subscription,
    requestPermission,
    unsubscribe
  };
}

