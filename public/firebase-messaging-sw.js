// Firebase Cloud Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Initialize Firebase in the service worker
// NOTE: service workers can't read build-time env vars — inject this config at
// build/deploy time. Firebase web config is public-by-design, but left as a
// placeholder here so no project-identifying key is committed.
firebase.initializeApp({
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "botkorp-za.firebaseapp.com",
  projectId: "botkorp-za",
  storageBucket: "botkorp-za.firebasestorage.app",
  messagingSenderId: "695066639923",
  appId: "1:695066639923:web:61c02d57bbee2230f22d46",
  measurementId: "G-KM8CEB9V0C"
});

// Retrieve an instance of Firebase Messaging
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message:', payload);

  const notificationTitle = payload.notification?.title || 'New Notification';
  const notificationOptions = {
    body: payload.notification?.body || 'You have a new notification',
    icon: '/icon.png',
    badge: '/icon.png',
    data: payload.data || {},
    tag: payload.data?.notification_id || 'notification',
    requireInteraction: payload.data?.priority === 'urgent'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Notification click received:', event);

  event.notification.close();

  // Get the URL to open from the notification data
  const urlToOpen = event.notification.data?.url || event.notification.data?.action_url || '/portal';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (const client of clientList) {
          if (client.url.includes(urlToOpen) && 'focus' in client) {
            return client.focus();
          }
        }
        // If no window is open, open a new one
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Optional: Handle push events (for native push without Firebase)
self.addEventListener('push', (event) => {
  if (event.data) {
    try {
      const data = event.data.json();
      console.log('[firebase-messaging-sw.js] Push event received:', data);
      
      const notificationTitle = data.title || 'New Notification';
      const notificationOptions = {
        body: data.body || data.message,
        icon: '/icon.png',
        badge: '/icon.png',
        data: data
      };

      event.waitUntil(
        self.registration.showNotification(notificationTitle, notificationOptions)
      );
    } catch (error) {
      console.error('[firebase-messaging-sw.js] Error parsing push data:', error);
    }
  }
});

