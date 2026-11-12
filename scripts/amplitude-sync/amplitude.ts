// Minimal Amplitude Taxonomy API client: https://amplitude.com/docs/apis/analytics/taxonomy
// Deliberately has no delete method. Credentials are only used to build the
// Authorization header and never appear in errors or logs.
import type { CollectedEntry } from './catalog.ts';
import type { AmplitudeCategory, AmplitudeEvent, EventChanges } from './plan.ts';

export const DEFAULT_HOST = 'https://amplitude.com';
const MAX_BODY_IN_ERROR = 2000;
const MAX_DELAY_MS = 60_000;

export type FetchResponseLike = {
  status: number;
  text: () => Promise<string>;
  headers?: { get: (name: string) => string | null };
};

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<FetchResponseLike>;

export type ClientOptions = {
  host?: string;
  apiKey: string;
  secretKey: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
  log?: (message: string) => void;
};

export class AmplitudeApiError extends Error {
  status: number;

  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'AmplitudeApiError';
    this.status = status;
    this.body = body;
  }
}

export type AmplitudeClient = {
  listEvents: () => Promise<AmplitudeEvent[]>;
  listCategories: () => Promise<AmplitudeCategory[]>;
  createCategory: (name: string) => Promise<void>;
  createEvent: (entry: Pick<CollectedEntry, 'name' | 'description' | 'category'>) => Promise<void>;
  updateEvent: (name: string, changes: EventChanges) => Promise<void>;
};

const isRetryableStatus = (status: number) => status === 429 || status >= 500;

const truncate = (text: string) =>
  text.length > MAX_BODY_IN_ERROR ? `${text.slice(0, MAX_BODY_IN_ERROR)}...` : text;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const retryAfterMs = (response: FetchResponseLike): number => {
  const seconds = Number(response.headers?.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
};

export const createAmplitudeClient = (options: ClientOptions): AmplitudeClient => {
  const host = (options.host || DEFAULT_HOST).replace(/\/+$/, '');
  const fetchFn: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const log = options.log ?? (() => undefined);
  const authorization = `Basic ${Buffer.from(`${options.apiKey}:${options.secretKey}`).toString(
    'base64',
  )}`;

  const backoff = (attempt: number, minimumMs = 0) =>
    Math.min(Math.max(baseDelayMs * 2 ** (attempt - 1), minimumMs), MAX_DELAY_MS);

  const request = async (
    method: string,
    apiPath: string,
    form?: Record<string, string>,
  ): Promise<unknown> => {
    const label = `${method} ${apiPath}`;
    const headers: Record<string, string> = {
      Authorization: authorization,
      Accept: 'application/json',
    };
    let body: string | undefined;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }

    for (let attempt = 1; ; attempt += 1) {
      let response: FetchResponseLike;
      try {
        // eslint-disable-next-line no-await-in-loop
        response = await fetchFn(`${host}${apiPath}`, { method, headers, body });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (attempt >= maxAttempts) {
          throw new AmplitudeApiError(
            `${label} failed after ${attempt} attempts: ${message}`,
            0,
            '',
          );
        }
        const delay = backoff(attempt);
        log(`${label}: network error (${message}), retrying in ${delay}ms`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(delay);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const text = await response.text();
      if (isRetryableStatus(response.status) && attempt < maxAttempts) {
        const delay = backoff(attempt, retryAfterMs(response));
        log(`${label}: HTTP ${response.status}, retrying in ${delay}ms (attempt ${attempt})`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(delay);
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new AmplitudeApiError(
          `${label} -> HTTP ${response.status}: ${truncate(text)}`,
          response.status,
          text,
        );
      }
      const json = parseJson(text);
      if (
        typeof json === 'object' &&
        json !== null &&
        'success' in json &&
        json.success === false
      ) {
        throw new AmplitudeApiError(
          `${label} -> success=false: ${truncate(text)}`,
          response.status,
          text,
        );
      }
      return json;
    }
  };

  const listData = async (apiPath: string): Promise<unknown[]> => {
    const json = await request('GET', apiPath);
    const data =
      typeof json === 'object' && json !== null && 'data' in json ? json.data : undefined;
    if (!Array.isArray(data)) {
      throw new AmplitudeApiError(`GET ${apiPath}: response has no data array`, 200, '');
    }
    return data;
  };

  return {
    // The Taxonomy API returns these shapes; only the fields in the types are read.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    listEvents: async () => (await listData('/api/2/taxonomy/event')) as AmplitudeEvent[],
    listCategories: async () =>
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      (await listData('/api/2/taxonomy/category')) as AmplitudeCategory[],
    createCategory: async (name) => {
      // eslint-disable-next-line camelcase
      await request('POST', '/api/2/taxonomy/category', { category_name: name });
    },
    createEvent: async ({ name, description, category }) => {
      await request('POST', '/api/2/taxonomy/event', {
        // eslint-disable-next-line camelcase
        event_type: name,
        category,
        description,
      });
    },
    updateEvent: async (name, changes) => {
      const form: Record<string, string> = {};
      if (changes.description !== undefined) {
        form.description = changes.description;
      }
      if (changes.category !== undefined) {
        form.category = changes.category;
      }
      await request('PUT', `/api/2/taxonomy/event/${encodeURIComponent(name)}`, form);
    },
  };
};
