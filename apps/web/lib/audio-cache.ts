// IndexedDB-backed cache for TTS audio blobs. Keyed by sha256(voice|text) so
// re-reading the same message with the same voice is instant and free.

const DB_NAME = 'artifigenz-tts';
const STORE = 'audio';
const DB_VERSION = 1;
const MAX_ENTRIES = 80; // ~ a few MB; evict oldest on overflow

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('indexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function audioCacheKey(text: string, voice: string): Promise<string> {
  const data = new TextEncoder().encode(`${voice}|${text}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export async function getCachedAudio(key: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const row = req.result as { blob: Blob } | undefined;
        resolve(row?.blob ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function setCachedAudio(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put({ key, blob, createdAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    void evictIfNeeded();
  } catch {
    /* cache best-effort; ignore */
  }
}

async function evictIfNeeded(): Promise<void> {
  try {
    const db = await openDb();
    const keys = await new Promise<{ key: string; createdAt: number }[]>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const out: { key: string; createdAt: number }[] = [];
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            out.push({
              key: cursor.key as string,
              createdAt: (cursor.value as { createdAt: number }).createdAt,
            });
            cursor.continue();
          } else {
            resolve(out);
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      },
    );
    if (keys.length <= MAX_ENTRIES) return;
    keys.sort((a, b) => a.createdAt - b.createdAt);
    const toDelete = keys.slice(0, keys.length - MAX_ENTRIES);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const { key } of toDelete) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
