// End-to-end tests of sync.ts against a local fake Taxonomy API (no real network).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const SYNC = path.resolve(import.meta.dirname, '..', 'sync.ts');

type Result = { code: number; stdout: string; stderr: string };

const run = (args: string[], env: Record<string, string | undefined> = {}): Promise<Result> =>
  new Promise((resolve) => {
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      GITHUB_STEP_SUMMARY: '',
    };
    delete childEnv.AMPLITUDE_API_KEY;
    delete childEnv.AMPLITUDE_SECRET_KEY;
    Object.assign(childEnv, env);
    execFile(
      process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SYNC, ...args],
      { env: childEnv },
      (error, stdout, stderr) => {
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr });
      },
    );
  });

type Request = { method: string; url: string; body: string; authorization?: string };

describe('sync.ts CLI', () => {
  const requests: Request[] = [];
  let events: unknown[] = [];
  let host = '';
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        body,
        authorization: req.headers.authorization,
      });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && req.url === '/api/2/taxonomy/event') {
        res.end(JSON.stringify({ success: true, data: events }));
      } else if (req.method === 'GET' && req.url === '/api/2/taxonomy/category') {
        res.end(JSON.stringify({ success: true, data: [{ id: 1, name: 'Other' }] }));
      } else if (req.method === 'POST' && body.includes('TEST+Sync+Test+B')) {
        res.writeHead(409);
        res.end(JSON.stringify({ success: false, errors: [{ message: 'already exists' }] }));
      } else {
        res.end(JSON.stringify({ success: true }));
      }
    });
  });
  const amplitudeEnv = () => ({
    AMPLITUDE_API_KEY: 'test-key',
    AMPLITUDE_SECRET_KEY: 'test-secret',
    AMPLITUDE_HOST: host,
  });

  before(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    server.close();
  });

  it('--validate passes on the tracked catalogs', async () => {
    const { code, stdout } = await run(['--validate']);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /TEST Sync Test A/);
    assert.match(stdout, /Validation passed/);
  });

  it('--validate fails on a broken catalog and writes the step summary', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-sync-'));
    const catalog = path.join(dir, 'broken.events.catalog.ts');
    const summary = path.join(dir, 'summary.md');
    fs.writeFileSync(
      catalog,
      [
        "import type { EventCatalog } from '@odh-dashboard/analytics/catalog';",
        'export const brokenEvents = {',
        "  SHORT: { name: 'Short', description: 'Too short', category: 'X' },",
        "  TODO: { name: 'Todo', description: 'TODO write a real description', category: 'X' },",
        "  EMPTY: { name: '', description: 'Has no name at all, sadly', category: 'X' },",
        '} as const satisfies EventCatalog;',
      ].join('\n'),
    );
    try {
      const { code, stdout } = await run(['--validate', catalog], { GITHUB_STEP_SUMMARY: summary });
      assert.equal(code, 1);
      assert.match(stdout, /brokenEvents\.SHORT\): description is too short/);
      assert.match(stdout, /brokenEvents\.TODO\): description contains placeholder text "TODO"/);
      assert.match(stdout, /brokenEvents\.EMPTY\): name is empty/);
      assert.match(fs.readFileSync(summary, 'utf8'), /Validation failed with 3 error\(s\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--sync without credentials exits non-zero with a clear message', async () => {
    const { code, stderr } = await run(['--sync']);
    assert.equal(code, 1);
    assert.match(
      stderr,
      /requires environment variable\(s\): AMPLITUDE_API_KEY, AMPLITUDE_SECRET_KEY/,
    );
  });

  it('rejects --dry-run without --sync', async () => {
    const { code, stderr } = await run(['--validate', '--dry-run']);
    assert.equal(code, 2);
    assert.match(stderr, /--dry-run can only be used with --sync/);
  });

  it('--sync --dry-run only reads', async () => {
    requests.length = 0;
    // eslint-disable-next-line camelcase
    events = [{ event_type: 'Legacy Event', description: '', category: null }];
    const { code, stdout } = await run(['--sync', '--dry-run'], amplitudeEnv());
    assert.equal(code, 0, stdout);
    assert.match(stdout, /DRY RUN/);
    assert.match(stdout, /To create: 3/);
    assert.match(stdout, /In Amplitude but in no catalog: 1/);
    assert.deepEqual(
      requests.map((r) => r.method),
      ['GET', 'GET'],
    );
    assert.equal(
      requests[0].authorization,
      `Basic ${Buffer.from('test-key:test-secret').toString('base64')}`,
    );
  });

  it('--sync writes sequentially, falls back to PUT on 409 and never deletes', async () => {
    requests.length = 0;
    events = [
      {
        // eslint-disable-next-line camelcase
        event_type: 'TEST Sync Test C',
        description: 'outdated',
        category: { name: 'TEST Sync Test' },
      },
    ];
    const { code, stdout } = await run(['--sync'], amplitudeEnv());
    assert.equal(code, 0, stdout);
    assert.deepEqual(
      requests.map((r) => `${r.method} ${decodeURIComponent(r.url)}`),
      [
        'GET /api/2/taxonomy/event',
        'GET /api/2/taxonomy/category',
        'POST /api/2/taxonomy/category',
        'POST /api/2/taxonomy/event',
        'POST /api/2/taxonomy/event',
        'PUT /api/2/taxonomy/event/TEST Sync Test B',
        'PUT /api/2/taxonomy/event/TEST Sync Test C',
      ],
    );
    assert.equal(requests[2].body, 'category_name=TEST+Sync+Test');
    assert.match(requests[6].body, /^description=Test\+entry\+C/);
    assert.doesNotMatch(stdout, /test-secret/);
    assert.match(stdout, /Created: 1/);
    assert.match(stdout, /Updated: 2/);
  });
});
