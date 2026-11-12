import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AmplitudeApiError,
  createAmplitudeClient,
  type FetchLike,
  type FetchResponseLike,
} from '../amplitude.ts';
import type { CollectedEntry } from '../catalog.ts';
import { executePlan } from '../execute.ts';
import { computePlan } from '../plan.ts';
import { renderSyncMarkdown, renderSyncText } from '../report.ts';

type Call = { method: string; url: string; headers: Record<string, string>; body?: string };

/** Fake fetch that replays queued responses and records every call. */
const fakeFetch = (responses: { status: number; body: unknown; retryAfter?: string }[]) => {
  const calls: Call[] = [];
  const queue = [...responses];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    const next = queue.shift();
    if (!next) {
      throw new Error(`unexpected request ${init.method} ${url}`);
    }
    const response: FetchResponseLike = {
      status: next.status,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
      headers: { get: (name) => (name === 'retry-after' ? next.retryAfter ?? null : null) },
    };
    return response;
  };
  return { fn, calls, remaining: () => queue.length };
};

const recordSleep = () => {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => void delays.push(ms) };
};

const clientWith = (fetch: FetchLike, sleep: (ms: number) => Promise<void>) =>
  createAmplitudeClient({
    host: 'https://amplitude.test/',
    apiKey: 'key',
    secretKey: 'secret',
    fetch,
    sleep,
    baseDelayMs: 100,
  });

const entry = (name: string, category = 'TEST Sync Test'): CollectedEntry => ({
  file: 'packages/x/events.catalog.ts',
  exportName: 'xEvents',
  key: name,
  name,
  description: `Description for ${name} that is long enough.`,
  category,
});

describe('createAmplitudeClient', () => {
  it('sends basic auth and form-encoded bodies', async () => {
    const fake = fakeFetch([{ status: 200, body: { success: true } }]);
    const { sleep } = recordSleep();
    await clientWith(fake.fn, sleep).updateEvent('TEST A/B & C', { description: 'New text' });

    const [call] = fake.calls;
    assert.equal(call.method, 'PUT');
    assert.equal(call.url, 'https://amplitude.test/api/2/taxonomy/event/TEST%20A%2FB%20%26%20C');
    assert.equal(
      call.headers.Authorization,
      `Basic ${Buffer.from('key:secret').toString('base64')}`,
    );
    assert.equal(call.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(call.body, 'description=New+text');
  });

  it('retries 429 and 5xx with exponential backoff, honouring Retry-After', async () => {
    const fake = fakeFetch([
      { status: 429, body: { success: false } },
      { status: 503, body: 'unavailable' },
      { status: 429, body: { success: false }, retryAfter: '3' },
      { status: 200, body: { success: true, data: [{ id: 1, name: 'Forms' }] } },
    ]);
    const { delays, sleep } = recordSleep();
    const categories = await clientWith(fake.fn, sleep).listCategories();

    assert.deepEqual(categories, [{ id: 1, name: 'Forms' }]);
    assert.equal(fake.calls.length, 4);
    assert.deepEqual(delays, [100, 200, 3000]);
  });

  it('gives up after 5 attempts and reports the last response body', async () => {
    const fake = fakeFetch(Array.from({ length: 5 }, () => ({ status: 429, body: 'slow down' })));
    const { sleep } = recordSleep();
    await assert.rejects(clientWith(fake.fn, sleep).createCategory('Forms'), (e: unknown) => {
      assert.ok(e instanceof AmplitudeApiError);
      assert.equal(e.status, 429);
      assert.match(e.message, /POST \/api\/2\/taxonomy\/category -> HTTP 429: slow down/);
      return true;
    });
    assert.equal(fake.calls.length, 5);
  });

  it('does not retry other 4xx responses and never leaks credentials', async () => {
    const fake = fakeFetch([{ status: 400, body: { success: false, errors: ['bad'] } }]);
    const { sleep } = recordSleep();
    await assert.rejects(clientWith(fake.fn, sleep).listEvents(), (e: unknown) => {
      assert.ok(e instanceof AmplitudeApiError);
      assert.equal(e.status, 400);
      assert.doesNotMatch(e.message, /secret|a2V5OnNlY3JldA/);
      return true;
    });
    assert.equal(fake.calls.length, 1);
  });

  it('treats success=false in a 2xx response as a failure', async () => {
    const fake = fakeFetch([{ status: 200, body: { success: false, errors: ['nope'] } }]);
    const { sleep } = recordSleep();
    await assert.rejects(clientWith(fake.fn, sleep).createCategory('Forms'), /success=false/);
  });
});

describe('executePlan', () => {
  it('creates categories first, falls back to PUT on 409 and never deletes', async () => {
    const plan = computePlan(
      [entry('TEST New'), entry('TEST Exists'), entry('TEST Changed')],
      [
        // eslint-disable-next-line camelcase
        { event_type: 'TEST Changed', description: 'old', category: { name: 'TEST Sync Test' } },
      ],
      [],
    );
    const fake = fakeFetch([
      { status: 200, body: { success: true } }, // POST category
      { status: 200, body: { success: true } }, // POST TEST New
      {
        status: 409,
        body: {
          success: false,
          errors: [{ message: 'Attempted to add an event type that already exists.' }],
        },
      }, // POST TEST Exists
      { status: 200, body: { success: true } }, // PUT TEST Exists
      { status: 429, body: 'rate limited' }, // PUT TEST Changed
      { status: 200, body: { success: true } }, // PUT TEST Changed (retry)
    ]);
    const { sleep } = recordSleep();
    const result = await executePlan(plan, clientWith(fake.fn, sleep));

    assert.deepEqual(
      fake.calls.map(
        (c) => `${c.method} ${decodeURIComponent(c.url.replace('https://amplitude.test', ''))}`,
      ),
      [
        'POST /api/2/taxonomy/category',
        'POST /api/2/taxonomy/event',
        'POST /api/2/taxonomy/event',
        'PUT /api/2/taxonomy/event/TEST Exists',
        'PUT /api/2/taxonomy/event/TEST Changed',
        'PUT /api/2/taxonomy/event/TEST Changed',
      ],
    );
    assert.ok(fake.calls.every((c) => c.method !== 'DELETE'));
    assert.deepEqual(result, {
      categoriesCreated: ['TEST Sync Test'],
      created: ['TEST New'],
      updated: ['TEST Exists', 'TEST Changed'],
      failures: [],
    });
    assert.equal(
      fake.calls[3].body,
      new URLSearchParams({
        description: entry('TEST Exists').description,
        category: 'TEST Sync Test',
      }).toString(),
    );
  });

  it('records failures and keeps going', async () => {
    const plan = computePlan([entry('TEST A'), entry('TEST B')], [], [{ name: 'TEST Sync Test' }]);
    const fake = fakeFetch([
      { status: 400, body: { success: false, errors: ['invalid'] } },
      { status: 200, body: { success: true } },
    ]);
    const { sleep } = recordSleep();
    const result = await executePlan(plan, clientWith(fake.fn, sleep));

    assert.deepEqual(result.created, ['TEST B']);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].name, 'TEST A');
    assert.match(result.failures[0].message, /HTTP 400/);
    assert.match(renderSyncText({ plan, result }), /FAILED writes: 1/);
    assert.match(renderSyncMarkdown({ plan, result }), /### Failed writes/);
  });
});

describe('sync report', () => {
  it('labels dry runs and lists planned writes', () => {
    const plan = computePlan(
      [entry('TEST New')],
      // eslint-disable-next-line camelcase
      [{ event_type: '[Amplitude] Start Session' }, { event_type: 'Legacy Event' }],
      [],
    );
    const text = renderSyncText({ plan, result: null });
    assert.match(text, /DRY RUN/);
    assert.match(text, /To create: 1\n {2}- TEST New/);
    assert.match(
      text,
      /In Amplitude but in no catalog: 2 \(1 Amplitude built-ins not listed\)\n {2}- Legacy Event/,
    );
    const markdown = renderSyncMarkdown({ plan, result: null });
    assert.match(markdown, /No changes were made/);
    assert.match(markdown, /\| To create \| 1 \|/);
  });
});
