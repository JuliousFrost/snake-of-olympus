type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function getSafeStorage(source: { localStorage?: StorageLike } | undefined | null): StorageLike | undefined {
  try {
    return source?.localStorage;
  } catch {
    return undefined;
  }
}

export function safeJsonRead<T>(storage: StorageLike | undefined | null, key: string, fallback: T): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // ignore unavailable storage
    }
    return fallback;
  }
}

export function safeJsonWrite<T>(storage: StorageLike | undefined | null, key: string, value: T): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
