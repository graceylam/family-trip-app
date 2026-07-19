export type PhotoQueueStatus =
  | "waiting"
  | "uploading"
  | "uploaded"
  | "needsAttention";

export type StoredQueuedPhoto = {
  id: string;
  stopId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  status: PhotoQueueStatus;
  isPrivate: boolean;
  pendingCloudDeletion: boolean;
  pendingLocalRemoval: boolean;
  uploadAttempts: number;
  lastError: string | null;
  googleDriveFileId: string | null;
  memberId: string;
  memberName: string;
  blob: Blob;
};

export type QueuedPhotoView = Omit<StoredQueuedPhoto, "blob"> & {
  previewUrl: string;
};

export type StorageHealth = {
  persistent: boolean;
  usage: number | null;
  quota: number | null;
};

const databaseName = "family-trip-photo-queue-clean-v1";
const databaseVersion = 2;
const storeName = "photos";
const stateStoreName = "photo-state";

type PhotoStateRecord = Omit<StoredQueuedPhoto, "blob">;

function normalizeRecord(record: StoredQueuedPhoto): StoredQueuedPhoto {
  const legacyStatus = (record as StoredQueuedPhoto & { status: PhotoQueueStatus | "private" }).status;
  return {
    ...record,
    status: legacyStatus === "private" || legacyStatus === "uploading" ? "waiting" : legacyStatus,
    isPrivate: record.isPrivate ?? legacyStatus === "private",
    pendingCloudDeletion: record.pendingCloudDeletion ?? false,
    pendingLocalRemoval: record.pendingLocalRemoval ?? false,
    uploadAttempts: record.uploadAttempts ?? 0,
    lastError: record.lastError ?? null,
    googleDriveFileId: record.googleDriveFileId ?? null,
    memberId: record.memberId ?? "unknown-member",
    memberName: record.memberName ?? "Family member",
  };
}

function mergePhotoState(record: StoredQueuedPhoto, state?: PhotoStateRecord): StoredQueuedPhoto {
  return normalizeRecord(state ? { ...record, ...state } : record);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Photo queue update was cancelled."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Photo queue update failed."));
  });
}

function openQueueDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in globalThis)) {
    return Promise.reject(new Error("This browser does not support the offline photo queue."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        const store = database.createObjectStore(storeName, { keyPath: "id" });
        store.createIndex("by-stop", "stopId", { unique: false });
        store.createIndex("by-status", "status", { unique: false });
        store.createIndex("by-created-at", "createdAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(stateStoreName)) {
        database.createObjectStore(stateStoreName, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open the offline photo queue."));
    request.onblocked = () => reject(new Error("The offline photo queue is open in another app version."));
  });
}

export async function listQueuedPhotos(): Promise<StoredQueuedPhoto[]> {
  const database = await openQueueDatabase();
  try {
    const transaction = database.transaction([storeName, stateStoreName], "readonly");
    const completion = transactionComplete(transaction);
    const [records, states] = await Promise.all([
      requestResult(transaction.objectStore(storeName).getAll() as IDBRequest<StoredQueuedPhoto[]>),
      requestResult(transaction.objectStore(stateStoreName).getAll() as IDBRequest<PhotoStateRecord[]>),
    ]);
    await completion;
    const stateById = new Map(states.map((state) => [state.id, state]));
    return records
      .map((record) => mergePhotoState(record, stateById.get(record.id)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } finally {
    database.close();
  }
}

export async function getQueuedPhoto(id: string): Promise<StoredQueuedPhoto | null> {
  const database = await openQueueDatabase();
  try {
    const transaction = database.transaction([storeName, stateStoreName], "readonly");
    const completion = transactionComplete(transaction);
    const [record, state] = await Promise.all([
      requestResult(transaction.objectStore(storeName).get(id) as IDBRequest<StoredQueuedPhoto | undefined>),
      requestResult(transaction.objectStore(stateStoreName).get(id) as IDBRequest<PhotoStateRecord | undefined>),
    ]);
    await completion;
    return record ? mergePhotoState(record, state) : null;
  } finally {
    database.close();
  }
}

export async function addQueuedPhotos(records: StoredQueuedPhoto[]): Promise<void> {
  if (records.length === 0) return;
  const database = await openQueueDatabase();
  try {
    const transaction = database.transaction([storeName, stateStoreName], "readwrite");
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(storeName);
    const stateStore = transaction.objectStore(stateStoreName);
    records.forEach((record) => {
      store.put(record);
      stateStore.delete(record.id);
    });
    await completion;
  } finally {
    database.close();
  }
}

export async function updateQueuedPhoto(
  id: string,
  changes: Partial<Omit<StoredQueuedPhoto, "id" | "blob">>,
): Promise<StoredQueuedPhoto> {
  const database = await openQueueDatabase();
  try {
    const transaction = database.transaction([storeName, stateStoreName], "readwrite");
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(storeName);
    const stateStore = transaction.objectStore(stateStoreName);
    const [storedPhoto, storedState] = await Promise.all([
      requestResult(store.get(id) as IDBRequest<StoredQueuedPhoto | undefined>),
      requestResult(stateStore.get(id) as IDBRequest<PhotoStateRecord | undefined>),
    ]);
    if (!storedPhoto) throw new Error("The queued photo could not be found.");
    const updated = { ...mergePhotoState(storedPhoto, storedState), ...changes };
    const { blob: _blob, ...metadata } = updated;
    void _blob;
    await requestResult(stateStore.put(metadata));
    await completion;
    return updated;
  } finally {
    database.close();
  }
}

export async function deleteQueuedPhoto(id: string): Promise<void> {
  const database = await openQueueDatabase();
  try {
    const transaction = database.transaction([storeName, stateStoreName], "readwrite");
    const completion = transactionComplete(transaction);
    transaction.objectStore(storeName).delete(id);
    transaction.objectStore(stateStoreName).delete(id);
    await completion;
  } finally {
    database.close();
  }
}

export async function getStorageHealth(): Promise<StorageHealth> {
  const storage = navigator.storage;
  const [persistent, estimate] = await Promise.all([
    storage?.persisted ? storage.persisted().catch(() => false) : Promise.resolve(false),
    storage?.estimate ? storage.estimate().catch(() => ({})) : Promise.resolve({}),
  ]);

  return {
    persistent,
    usage: estimate.usage ?? null,
    quota: estimate.quota ?? null,
  };
}

export async function requestPersistentStorage(): Promise<StorageHealth> {
  if (navigator.storage?.persist) {
    try {
      await navigator.storage.persist();
    } catch {
      // Persistence is a browser hint. A denied request must not block IndexedDB writes.
    }
  }
  return getStorageHealth();
}
