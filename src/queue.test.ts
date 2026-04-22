import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueQueueItemInStore,
  removeQueueItemFromStore,
  resolveQueueItemIdFromItems,
  type QueueItem,
} from './queue.js';

const COURSE_URL = 'https://www.coursera.org/learn/test-course/home/welcome';

function createQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: overrides.id ?? '11111111-1111-1111-1111-111111111111',
    url: overrides.url ?? COURSE_URL,
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? '2026-04-22T00:00:00.000Z',
    startedAt: overrides.startedAt ?? null,
    finishedAt: overrides.finishedAt ?? null,
    error: overrides.error ?? null,
    concurrency: overrides.concurrency ?? 3,
  };
}

test('enqueueQueueItemInStore allows re-adding a completed URL', () => {
  const store = {
    items: [createQueueItem({ status: 'completed' })],
  };

  const result = enqueueQueueItemInStore(store, COURSE_URL, 2);

  assert.equal(result.added, true);
  assert.ok(result.item);
  assert.equal(result.item?.concurrency, 2);
  assert.equal(store.items.length, 2);
});

test('removeQueueItemFromStore refuses to remove running items', () => {
  const store = {
    items: [createQueueItem({ status: 'running' })],
  };

  const result = removeQueueItemFromStore(store, store.items[0].id);

  assert.equal(result.removed, false);
  assert.equal(result.reason, 'running');
  assert.equal(store.items.length, 1);
});

test('removeQueueItemFromStore removes completed items', () => {
  const store = {
    items: [createQueueItem({ status: 'completed' })],
  };

  const result = removeQueueItemFromStore(store, store.items[0].id);

  assert.equal(result.removed, true);
  assert.equal(store.items.length, 0);
});

test('resolveQueueItemIdFromItems resolves a unique prefix', () => {
  const storeItems = [
    createQueueItem({ id: 'alpha-1111-1111-1111-111111111111' }),
    createQueueItem({ id: 'beta-2222-2222-2222-222222222222', url: 'https://www.coursera.org/learn/other/home/welcome' }),
  ];

  const result = resolveQueueItemIdFromItems(storeItems, 'alpha');

  assert.equal(result.matched, true);
  assert.equal(result.id, storeItems[0].id);
});

test('resolveQueueItemIdFromItems reports ambiguous prefixes', () => {
  const storeItems = [
    createQueueItem({ id: 'shared-1111-1111-1111-111111111111' }),
    createQueueItem({ id: 'shared-2222-2222-2222-222222222222', url: 'https://www.coursera.org/learn/other/home/welcome' }),
  ];

  const result = resolveQueueItemIdFromItems(storeItems, 'shared');

  assert.equal(result.matched, false);
  assert.equal(result.reason, 'ambiguous');
  assert.equal(result.matches?.length, 2);
});
