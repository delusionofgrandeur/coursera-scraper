import { randomUUID } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import { clampConcurrency, ensureDir, getConfigDir, validateCourseraUrl } from './security.js';

export type QueueStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface QueueItem {
  id: string;
  url: string;
  status: QueueStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  concurrency: number;
}

interface QueueStore {
  items: QueueItem[];
}

export interface EnqueueResult {
  added: boolean;
  item?: QueueItem;
  existing?: QueueItem;
}

export interface ResolveQueueItemIdResult {
  matched: boolean;
  id?: string;
  reason?: 'not_found' | 'ambiguous';
  matches?: QueueItem[];
}

export interface RemoveQueueItemResult {
  removed: boolean;
  reason?: 'not_found' | 'running' | 'ambiguous';
  item?: QueueItem;
  matches?: QueueItem[];
}

export interface QueueRunHooks {
  onRecoveredRunningItem?: (item: QueueItem) => void;
  onItemStart?: (item: QueueItem, index: number, total: number) => void;
  onItemSuccess?: (item: QueueItem, index: number, total: number) => void;
  onItemFailure?: (item: QueueItem, error: string, index: number, total: number) => void;
}

export interface QueueRunSummary {
  total: number;
  completed: number;
  failed: number;
  remainingPending: number;
  recoveredRunning: number;
}

const DEFAULT_QUEUE_CONCURRENCY = 3;

function getQueuePath(): string {
  return path.join(getConfigDir(), 'queue.json');
}

function readQueueStore(): QueueStore {
  const queuePath = getQueuePath();

  if (!fs.existsSync(queuePath)) {
    return { items: [] };
  }

  const raw = fs.readFileSync(queuePath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<QueueStore>;
  const items = Array.isArray(parsed.items) ? parsed.items : [];

  return {
    items: items.map((item) => ({
      id: String(item.id),
      url: String(item.url),
      status: normalizeStatus(item.status),
      createdAt: String(item.createdAt),
      startedAt: item.startedAt ? String(item.startedAt) : null,
      finishedAt: item.finishedAt ? String(item.finishedAt) : null,
      error: item.error ? String(item.error) : null,
      concurrency: clampConcurrency(Number(item.concurrency) || DEFAULT_QUEUE_CONCURRENCY),
    })),
  };
}

function writeQueueStore(store: QueueStore): void {
  const queuePath = getQueuePath();
  ensureDir(path.dirname(queuePath));

  const tempPath = `${queuePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tempPath, queuePath);
}

function normalizeStatus(value: unknown): QueueStatus {
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'failed') {
    return value;
  }

  return 'pending';
}

function normalizeQueueUrl(input: string): string {
  return validateCourseraUrl(input).toString();
}

export function getQueueItems(): QueueItem[] {
  return readQueueStore().items;
}

export function resolveQueueItemIdFromItems(
  items: readonly QueueItem[],
  idOrPrefix: string,
): ResolveQueueItemIdResult {
  const normalized = idOrPrefix.trim();
  if (!normalized) {
    return { matched: false, reason: 'not_found' };
  }

  const exactMatch = items.find((item) => item.id === normalized);
  if (exactMatch) {
    return { matched: true, id: exactMatch.id, matches: [exactMatch] };
  }

  const prefixMatches = items.filter((item) => item.id.startsWith(normalized));
  if (prefixMatches.length === 0) {
    return { matched: false, reason: 'not_found' };
  }

  if (prefixMatches.length > 1) {
    return { matched: false, reason: 'ambiguous', matches: prefixMatches };
  }

  return { matched: true, id: prefixMatches[0].id, matches: prefixMatches };
}

export function resolveQueueItemId(idOrPrefix: string): ResolveQueueItemIdResult {
  return resolveQueueItemIdFromItems(readQueueStore().items, idOrPrefix);
}

export function enqueueQueueItemInStore(
  store: QueueStore,
  url: string,
  concurrency = DEFAULT_QUEUE_CONCURRENCY,
): EnqueueResult {
  const normalizedUrl = normalizeQueueUrl(url);
  const effectiveConcurrency = clampConcurrency(concurrency);

  const existing = store.items.find(
    (item) => item.url === normalizedUrl && (item.status === 'pending' || item.status === 'running'),
  );

  if (existing) {
    return { added: false, existing };
  }

  const item: QueueItem = {
    id: randomUUID(),
    url: normalizedUrl,
    status: 'pending',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    concurrency: effectiveConcurrency,
  };

  store.items.push(item);
  return { added: true, item };
}

export function enqueueQueueItem(url: string, concurrency = DEFAULT_QUEUE_CONCURRENCY): EnqueueResult {
  const store = readQueueStore();
  const result = enqueueQueueItemInStore(store, url, concurrency);

  if (result.added) {
    writeQueueStore(store);
  }

  return result;
}

export function removeQueueItemFromStore(store: QueueStore, idOrPrefix: string): RemoveQueueItemResult {
  const resolved = resolveQueueItemIdFromItems(store.items, idOrPrefix);
  if (!resolved.matched || !resolved.id) {
    return {
      removed: false,
      reason: resolved.reason,
      matches: resolved.matches,
    };
  }

  const item = store.items.find((entry) => entry.id === resolved.id);
  if (!item) {
    return { removed: false, reason: 'not_found' };
  }

  if (item.status === 'running') {
    return { removed: false, reason: 'running', item };
  }

  store.items = store.items.filter((entry) => entry.id !== item.id);
  return { removed: true, item };
}

export function removeQueueItem(idOrPrefix: string): RemoveQueueItemResult {
  const store = readQueueStore();
  const result = removeQueueItemFromStore(store, idOrPrefix);

  if (result.removed) {
    writeQueueStore(store);
  }

  return result;
}

export function retryFailedQueueItems(): number {
  const store = readQueueStore();
  let retried = 0;

  for (const item of store.items) {
    if (item.status !== 'failed') {
      continue;
    }

    item.status = 'pending';
    item.error = null;
    item.startedAt = null;
    item.finishedAt = null;
    retried += 1;
  }

  if (retried > 0) {
    writeQueueStore(store);
  }

  return retried;
}

export async function runQueue(
  worker: (url: string, concurrency: number) => Promise<void>,
  hooks: QueueRunHooks = {},
): Promise<QueueRunSummary> {
  const store = readQueueStore();
  let recoveredRunning = 0;

  for (const item of store.items) {
    if (item.status !== 'running') {
      continue;
    }

    item.status = 'pending';
    item.startedAt = null;
    item.finishedAt = null;
    item.error = null;
    recoveredRunning += 1;
    hooks.onRecoveredRunningItem?.(item);
  }

  if (recoveredRunning > 0) {
    writeQueueStore(store);
  }

  const pendingItems = store.items.filter((item) => item.status === 'pending');
  const total = pendingItems.length;
  let completed = 0;
  let failed = 0;

  for (let index = 0; index < pendingItems.length; index += 1) {
    const pendingItem = pendingItems[index];
    const currentItem = store.items.find((item) => item.id === pendingItem.id);

    if (!currentItem) {
      continue;
    }

    currentItem.status = 'running';
    currentItem.startedAt = new Date().toISOString();
    currentItem.finishedAt = null;
    currentItem.error = null;
    writeQueueStore(store);
    hooks.onItemStart?.(currentItem, index + 1, total);

    try {
      await worker(currentItem.url, currentItem.concurrency);
      currentItem.status = 'completed';
      currentItem.finishedAt = new Date().toISOString();
      currentItem.error = null;
      completed += 1;
      writeQueueStore(store);
      hooks.onItemSuccess?.(currentItem, index + 1, total);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      currentItem.status = 'failed';
      currentItem.finishedAt = new Date().toISOString();
      currentItem.error = message;
      failed += 1;
      writeQueueStore(store);
      hooks.onItemFailure?.(currentItem, message, index + 1, total);
    }
  }

  return {
    total,
    completed,
    failed,
    remainingPending: store.items.filter((item) => item.status === 'pending').length,
    recoveredRunning,
  };
}
