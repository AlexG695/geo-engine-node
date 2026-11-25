import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GeoEngine,
  GeoEngineError,
  IdentityIntegrationError,
  IdentityTransientError,
  ValidationError,
} from '../src/index.js';
import { USER_AGENT } from '../src/http.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((done) => {
          s.closeAllConnections?.();
          s.close(() => done());
        })
    )
  );
});

function listen(handler: (req: any, res: any) => void): Promise<{ url: string; hits: () => number }> {
  return new Promise((resolve) => {
    let hits = 0;
    const server = createServer((req, res) => {
      hits++;
      handler(req, res);
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, hits: () => hits });
    });
  });
}

describe('service URL validation', () => {
  const key = 'k-test';

  it.each([
    ['http://example.com'],
    ['http://api.geoengine.dev'],
    ['ftp://example.com'],
    ['not a url'],
    ['http://127.0.0.1.example.com'],
  ])('rejects %s before sending anything', (baseUrl) => {
    expect(() => new GeoEngine(key, { baseUrl })).toThrow(ValidationError);
  });

  it.each([
    ['https://example.com'],
    ['http://localhost:8080'],
    ['http://127.0.0.1:8080'],
    ['http://[::1]:8080'],
  ])('accepts %s', (baseUrl) => {
    expect(() => new GeoEngine(key, { baseUrl })).not.toThrow();
  });

  it('also validates managementUrl, ingestUrl and apiServiceUrl', () => {
    for (const opt of ['managementUrl', 'ingestUrl', 'apiServiceUrl']) {
      expect(() => new GeoEngine(key, { [opt]: 'http://example.com' })).toThrow(ValidationError);
    }
  });

  it('names the offending option without echoing the API key', () => {
    try {
      new GeoEngine(key, { baseUrl: 'http://example.com' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain('baseUrl');
      expect((err as Error).message).not.toContain(key);
    }
  });
});

describe('redirects', () => {
  it('does not follow redirects, so credentials never reach another origin', async () => {
    const target = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    const origin = await listen((_req, res) => {
      res.writeHead(302, { Location: `${target.url}/stolen` });
      res.end();
    });

    const client = new GeoEngine('k-test', { baseUrl: origin.url, maxRetries: 0 });
    await expect(client.sendLocation('truck-1', 19.4, -99.1)).rejects.toBeDefined();

    expect(origin.hits()).toBe(1);
    expect(target.hits()).toBe(0);
  });
});

describe('version single source', () => {
  it('USER_AGENT contains the version from package.json', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(USER_AGENT).toBe(`GeoEngineNodeSDK/${pkg.version}`);
  });
});

describe('no secret leakage', () => {
  // Built at runtime so the literal never appears as a plain string in the repo.
  const SECRET = ['t3st', 'secret', 'value', '9f2c1d'].join('-');

  function surfaces(value: unknown): string[] {
    const out: string[] = [];
    out.push(inspect(value, { depth: 10, showHidden: true }));
    out.push(inspect(value, { depth: null, showHidden: false }));
    try {
      out.push(JSON.stringify(value) ?? '');
    } catch {
      /* circular or non-serializable: nothing to leak */
    }
    out.push(String(value));
    if (value instanceof Error) {
      out.push(value.message, value.stack ?? '');
    }
    return out;
  }

  function expectNoSecret(value: unknown) {
    for (const s of surfaces(value)) {
      expect(s).not.toContain(SECRET);
    }
  }

  it('client, its options and its services never contain the key', () => {
    const client = new GeoEngine(SECRET, { baseUrl: 'https://example.com', jwtToken: 'jwt-x' });
    expectNoSecret(client);
    expectNoSecret(client.options);
    expectNoSecret(client.spatial);
    expectNoSecret(client.users);
    expectNoSecret(client.geoIdentity);
    expectNoSecret(client.identity);
    expect('apiKey' in client.options).toBe(false);
  });

  it('identity errors never contain the key, even if the message echoes it', () => {
    const transient = new IdentityTransientError({
      message: `upstream said ${SECRET}`,
      detail: SECRET,
      reason: 'server_error',
      apiKeyToRedact: SECRET,
    });
    const integration = new IdentityIntegrationError({
      message: `bad key ${SECRET}`,
      title: SECRET,
      reason: 'invalid_request',
      apiKeyToRedact: SECRET,
    });
    expectNoSecret(transient);
    expectNoSecret(integration);
  });

  it('base errors raised from a server that echoes the key do not contain it', async () => {
    const echo = await listen((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: `invalid key ${SECRET}` } }));
    });
    const client = new GeoEngine(SECRET, { baseUrl: echo.url, maxRetries: 0 });
    const err = await client.sendLocation('truck-1', 19.4, -99.1).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expectNoSecret(err);

    const idErr = await client.identity
      .evaluate({ scope: 'login', subject: { user_id: 'u1' }, context: { ip: '203.0.113.42' } })
      .catch((e) => e);
    expect(idErr).toBeInstanceOf(Error);
    expectNoSecret(idErr);
  });

  it('plain base errors do not contain the key', () => {
    expectNoSecret(new ValidationError('x'));
    expectNoSecret(new GeoEngineError('x'));
    expect(() => new GeoEngine(SECRET, { baseUrl: 'http://example.com' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(SECRET) })
    );
  });
});
