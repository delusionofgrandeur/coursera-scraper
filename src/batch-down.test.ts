import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page, Response } from 'playwright';
import {
  assertBatchDownloadItemsFound,
  finalizeBatchDownloadFailures,
  getBatchDownloadPipelineSettings,
  prepareCourseItemJob,
  type BatchDownloadItemFailure,
  type CourseItem,
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

test('getBatchDownloadPipelineSettings uses selected concurrency for downloads and caps resolvers', () => {
  assert.deepEqual(getBatchDownloadPipelineSettings(3), {
    downloadConcurrency: 3,
    resolverConcurrency: 3,
    bufferSize: 6,
  });

  assert.deepEqual(getBatchDownloadPipelineSettings(5), {
    downloadConcurrency: 5,
    resolverConcurrency: 3,
    bufferSize: 10,
  });
});

test('prepareCourseItemJob skips existing video files before resolving the video URL', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coursera-scraper-test-'));
  const item: CourseItem = {
    url: 'https://www.coursera.org/learn/test-course/lecture/example/existing',
    folderName: 'week_01',
    order: 1,
  };

  fs.mkdirSync(path.join(tempDir, 'week_01'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'week_01', '01_Existing.mp4'), 'already downloaded');

  let videoPayloadRead = false;
  let fallbackEvaluated = false;
  const fakeResponse = {
    ok: () => true,
    json: async () => {
      videoPayloadRead = true;
      return { url: 'https://example.com/video.mp4' };
    },
  } as unknown as Response;
  const fakePage = {
    waitForResponse: () => Promise.resolve(fakeResponse),
    goto: async () => null,
    waitForSelector: async () => null,
    waitForLoadState: async () => undefined,
    title: async () => 'Existing | Coursera',
    evaluate: async () => {
      fallbackEvaluated = true;
      return null;
    },
  } as unknown as Page;

  try {
    const job = await prepareCourseItemJob(fakePage, item, tempDir);

    assert.equal(job.kind, 'skip');
    assert.equal(videoPayloadRead, false);
    assert.equal(fallbackEvaluated, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
