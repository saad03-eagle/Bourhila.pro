// ===================================================================
// AVICOLE PRO - SERVICE WORKER (Offline-First Architecture)
// ===================================================================

const CACHE_NAME = 'avicole-pro-v1';
const URLS_TO_CACHE = [
  '/',
  '/avicole-pro.html',
  '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Install event - Cache essential resources
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Caching app shell');
        return cache.addAll(URLS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - Network first, fallback to cache (for dynamic content)
// Cache first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Skip cross-origin requests
  if (!request.url.startsWith(self.location.origin) && 
      !request.url.includes('cdn.tailwindcss.com') &&
      !request.url.includes('unpkg.com') &&
      !request.url.includes('cdn.jsdelivr.net')) {
    return;
  }
  
  // Cache-first strategy for static assets
  if (request.url.includes('.css') || 
      request.url.includes('.js') || 
      request.url.includes('cdn.') ||
      request.url.includes('unpkg.com')) {
    event.respondWith(
      caches.match(request).then((response) => {
        return response || fetch(request).then((fetchResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, fetchResponse.clone());
            return fetchResponse;
          });
        });
      }).catch(() => {
        // Return offline page or cached version
        return caches.match(request);
      })
    );
  } else {
    // Network-first strategy for HTML/API calls
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone the response
          const responseToCache = response.clone();
          
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
          
          return response;
        })
        .catch(() => {
          // Network failed, try cache
          return caches.match(request).then((response) => {
            if (response) {
              return response;
            }
            
            // If not in cache and it's a navigation request, return index
            if (request.mode === 'navigate') {
              return caches.match('/avicole-pro.html');
            }
          });
        })
    );
  }
});

// Background sync for offline data submission
self.addEventListener('sync', (event) => {
  console.log('[ServiceWorker] Background sync', event.tag);
  
  if (event.tag === 'sync-data') {
    event.waitUntil(syncOfflineData());
  }
});

// Sync offline data to server when connection is restored
async function syncOfflineData() {
  try {
    // Open IndexedDB and retrieve pending data
    const db = await openIndexedDB();
    
    // Get all stores
    const stores = ['mortalite', 'environnemental', 'stock', 'production'];
    
    for (const storeName of stores) {
      const data = await getAllFromStore(db, storeName);
      
      // Send each record to server
      for (const record of data) {
        if (!record.synced) {
          try {
            await fetch('/api/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ store: storeName, data: record })
            });
            
            // Mark as synced
            record.synced = true;
            await updateRecord(db, storeName, record);
            
            console.log(`[ServiceWorker] Synced ${storeName} record`);
          } catch (error) {
            console.error(`[ServiceWorker] Failed to sync ${storeName}:`, error);
          }
        }
      }
    }
    
    console.log('[ServiceWorker] All data synced');
  } catch (error) {
    console.error('[ServiceWorker] Sync failed:', error);
    throw error;
  }
}

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AvicoleProDB', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const objectStore = transaction.objectStore(storeName);
    const request = objectStore.getAll();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function updateRecord(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const objectStore = transaction.objectStore(storeName);
    const request = objectStore.put(record);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Push notifications (for critical alerts)
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push received');
  
  const options = {
    body: event.data ? event.data.text() : 'Nouvelle notification Avicole Pro',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    vibrate: [200, 100, 200],
    tag: 'avicole-notification',
    requireInteraction: true
  };
  
  event.waitUntil(
    self.registration.showNotification('Avicole Pro', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[ServiceWorker] Notification clicked');
  
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/')
  );
});
