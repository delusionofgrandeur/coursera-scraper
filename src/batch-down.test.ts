import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertBatchDownloadItemsFound,
  finalizeBatchDownloadFailures,
  type BatchDownloadItemFailure,
} from './batch-down.js';

test('assertBatchDownloadItemsFound fails when scan finds no items', () => {
  assert.throws(
    () => assertBatchDownloadItemsFound([]),
    /no downloadable content items were discovered/i,
  );
});

test('finalizeBatchDownloadFailures fails when any item processing failed', () => {
  const failures: BatchDownloadItemFailure[] = [
    {
      url: 'https://www.coursera.org/learn/test-course/lecture/example',
      message: 'Video URL could not be resolved for this lesson.',
    },
  ];

  assert.throws(
    () => finalizeBatchDownloadFailures(failures),
    /download finished with 1 failed item/i,
  );
});
