import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { inspect } from 'node:util';

import GeoEngine, {
  IdentityTransientError as RootTransientError,
  IdentityIntegrationError as RootIntegrationError,
  isTransient as rootIsTransient,
} from '../dist/index.js';
import {
  identityGuard,
  IdentityTransientError,
  IdentityIntegrationError,
  isTransient,
} from '../dist/identity.js';

const require = createRequire(import.meta.url);
const cjsIdentity = require('../dist/identity.cjs');
const cjsRoot = require('../dist/index.cjs');

let closeActiveServer = null;

afterEach(async () => {
  if (closeActiveServer) {
    await closeActiveServer();
    closeActiveServer = null;
  }
  if ('window' in globalThis) {
    delete globalThis.window;
  }
});

async function startMockServer(handler) {
  const captured = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const entry = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      };
      captured.push(entry);
      handler(entry, res, captured.length);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  closeActiveServer = () =>
    new Promise((done) => {
      server.closeAllConnections?.();
      server.close(() => done());
    });
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, captured };
}

function makeClient(url, opts = {}) {
  return new GeoEngine('sk_test_super_secret_key_value', {
    apiServiceUrl: url,
    ...opts,
  });
}

function runMiddleware(middleware, req = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const state = {
      nextCalled: false,
      nextArg: undefined,
      statusCode: 200,
      headers: {},
      body: undefined,
    };

    const finish = () => {
      if (!settled) {
        settled = true;
        resolve(state);
      }
    };

    const res = {
      headersSent: false,
      writableEnded: false,
      statusCode: 200,
      setHeader(name, value) {
        state.headers[name.toLowerCase()] = value;
      },
      status(code) {
        state.statusCode = code;
        this.statusCode = code;
        return {
          json(payload) {
            state.body = payload;
            res.headersSent = true;
            res.writableEnded = true;
            finish();
          },
          end(chunk) {
            state.body = chunk ? JSON.parse(chunk) : undefined;
            res.headersSent = true;
            res.writableEnded = true;
            finish();
          },
        };
      },
      json(payload) {
        state.statusCode = this.statusCode;
        state.body = payload;
        this.headersSent = true;
        this.writableEnded = true;
        finish();
      },
      end(chunk) {
        state.statusCode = this.statusCode;
        state.body = chunk ? JSON.parse(chunk) : undefined;
        this.headersSent = true;
        this.writableEnded = true;
        finish();
      },
    };

    const next = (arg) => {
      state.nextCalled = true;
      state.nextArg = arg;
      finish();
    };

    middleware(req, res, next);
  });
}

describe('GeoIdentity /v1/evaluate & identityGuard', () => {
  it('handles contract example: ALLOW by default', async () => {
    const mock = await startMockServer((req, res) => {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/v1/evaluate');
      const payload = JSON.parse(req.body);
      assert.equal(payload.scope, 'login');
      assert.equal(payload.subject.user_id, 'user_2abc123');

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Request-Id': req.headers['x-request-id'],
        'Cache-Control': 'no-store',
      });
      res.end(
        JSON.stringify({
          decision: 'ALLOW',
          matched_rule: null,
          default_applied: true,
          reason: 'DEFAULT_ACTION',
          signals: [],
          shadow_matches: [],
          meta: {
            config_version: 42,
            stale: false,
            config_age_s: 0,
            source: 'postgres',
            evaluated_at: '2026-11-20T18:30:00.412Z',
            request_id: req.headers['x-request-id'],
            reputation: 'not_needed',
          },
        })
      );
    });

    const client = makeClient(mock.url);
    const result = await client.identity.evaluate({
      scope: 'login',
      subject: { user_id: 'user_2abc123', roles: ['admin'], device_id: 'dev_9f8e7d' },
      context: { ip: '203.0.113.42' },
    });

    assert.equal(result.decision, 'ALLOW');
    assert.equal(result.matched_rule, null);
    assert.equal(result.default_applied, true);
    assert.equal(result.reason, 'DEFAULT_ACTION');
    assert.equal(result.meta.reputation, 'not_needed');

    const decisions = [];
    const guard = identityGuard({
      client,
      scope: 'login',
      failOpen: false,
      getSubject: () => ({ user_id: 'user_2abc123' }),
      onDecision: (d) => {
        decisions.push(d);
      },
    });
    const out = await runMiddleware(guard);
    assert.equal(out.nextCalled, true);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].decision, 'ALLOW');
  });

  it('handles contract example: BLOCK enforce and guard 403', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          decision: 'BLOCK',
          matched_rule: { id: 'rule_1', name: 'Bloqueo geográfico', priority: 5 },
          default_applied: false,
          reason: 'RULE_MATCH',
          signals: ['outside_geo_limit'],
          shadow_matches: [],
          meta: {
            config_version: 42,
            stale: false,
            config_age_s: 0,
            source: 'postgres',
            evaluated_at: '2026-11-20T18:30:00.415Z',
            request_id: 'req_block',
          },
        })
      );
    });

    const client = makeClient(mock.url);
    const evalRes = await client.identity.evaluate({
      scope: 'login',
      subject: { user_id: 'user_1' },
      context: { location: { lat: 19.43, lng: -99.13, accuracy_m: 20, source: 'device' } },
    });
    assert.equal(evalRes.decision, 'BLOCK');
    assert.deepEqual(evalRes.signals, ['outside_geo_limit']);

    const guard = identityGuard({
      client,
      scope: 'login',
      failOpen: true,
      getSubject: () => ({ user_id: 'user_1' }),
    });
    const out = await runMiddleware(guard);
    assert.equal(out.nextCalled, false);
    assert.equal(out.statusCode, 403);
    assert.deepEqual(out.body, { error: 'access_denied' });
  });

  it('handles contract example: CHALLENGE with onChallenge callback', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          decision: 'CHALLENGE',
          matched_rule: {
            id: 'rule_9',
            name: 'Fuera de la zona del administrador',
            priority: 20,
          },
          default_applied: false,
          reason: 'RULE_MATCH',
          signals: ['outside_geo_limit'],
          shadow_matches: [],
          challenge: { hint: 'step_up' },
          meta: {
            config_version: 42,
            stale: false,
            config_age_s: 0,
            source: 'postgres',
            evaluated_at: '2026-11-20T18:30:00.431Z',
            request_id: 'req_03',
            reputation: 'ok',
          },
        })
      );
    });

    const client = makeClient(mock.url);
    let challengeDecision = null;
    const guard = identityGuard({
      client,
      scope: 'login',
      failOpen: false,
      getSubject: () => ({ user_id: 'user_admin' }),
      onChallenge: (decision, _req, res) => {
        challengeDecision = decision;
        res.status(401).json({ stepUpRequired: true, hint: decision.challenge?.hint });
      },
    });

    const out = await runMiddleware(guard);
    assert.equal(out.nextCalled, false);
    assert.equal(out.statusCode, 401);
    assert.deepEqual(out.body, { stepUpRequired: true, hint: 'step_up' });
    assert.equal(challengeDecision?.challenge?.hint, 'step_up');
  });

  it('handles monitor rule in shadow_matches without changing ALLOW decision', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          decision: 'ALLOW',
          matched_rule: null,
          default_applied: true,
          reason: 'DEFAULT_ACTION',
          signals: [],
          shadow_matches: [
            {
              rule: { id: 'rule_7', name: 'Fuera de zona permitida', priority: 10 },
              would_decide: 'BLOCK',
              signals: ['outside_geo_limit'],
            },
          ],
          meta: {
            config_version: 42,
            stale: false,
            config_age_s: 0,
            source: 'postgres',
            evaluated_at: '2026-11-20T18:30:00.420Z',
            request_id: 'req_02',
          },
        })
      );
    });

    const client = makeClient(mock.url);
    const res = await client.identity.evaluate({
      scope: 'login',
      subject: { user_id: 'user_2' },
    });
    assert.equal(res.decision, 'ALLOW');
    assert.equal(res.shadow_matches.length, 1);
    assert.equal(res.shadow_matches[0].would_decide, 'BLOCK');

    const guard = identityGuard({
      client,
      scope: 'login',
      failOpen: false,
      getSubject: () => ({ user_id: 'user_2' }),
    });
    const out = await runMiddleware(guard);
    assert.equal(out.nextCalled, true);
  });

  it('treats location_missing (200 with BLOCK) as a normal decision, not an error', async () => {
    const mock = await startMockServer((req, res) => {
      const payload = JSON.parse(req.body);
      assert.equal(payload.context?.location, undefined);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          decision: 'BLOCK',
          matched_rule: { id: 'rule_geo', name: 'Requiere ubicación', priority: 1 },
          default_applied: false,
          reason: 'RULE_MATCH',
          signals: ['location_missing'],
          shadow_matches: [],
          meta: {
            config_version: 5,
            stale: false,
            config_age_s: 0,
            source: 'postgres',
            evaluated_at: '2026-11-20T18:31:00.000Z',
            request_id: 'req_loc',
          },
        })
      );
    });

    const client = makeClient(mock.url);
    const res = await client.identity.evaluate({
      scope: 'checkout',
      subject: { device_id: 'dev_1' },
    });
    assert.equal(res.decision, 'BLOCK');
    assert.deepEqual(res.signals, ['location_missing']);

    const guard = identityGuard({
      client,
      scope: 'checkout',
      failOpen: true,
      getSubject: () => ({ device_id: 'dev_1' }),
    });
    const out = await runMiddleware(guard);
    assert.equal(out.nextCalled, false);
    assert.equal(out.statusCode, 403);
  });

  it('handles timeout on headers and slow body in evaluate and applies failOpen true/false in guard', async () => {
    const mock = await startMockServer((_req, res) => {
      const timer = setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{}');
        }
      }, 200);
      timer.unref();
    });

    const client = makeClient(mock.url, { identityTimeoutMs: 45 });
    const err = await client.identity
      .evaluate({ scope: 'login', subject: { user_id: 'u1' } })
      .catch((e) => e);

    assert.ok(err instanceof IdentityTransientError);
    assert.ok(err instanceof RootTransientError);
    assert.ok(err instanceof cjsIdentity.IdentityTransientError);
    assert.equal(isTransient(err), true);
    assert.equal(rootIsTransient(err), true);
    assert.equal(cjsIdentity.isTransient(err), true);
    assert.equal(err.reason, 'timeout');
    assert.ok(err.requestId);

    const openDecisions = [];
    const guardOpen = identityGuard({
      client,
      scope: 'login',
      failOpen: true,
      getSubject: () => ({ user_id: 'u1' }),
      onDecision: (d) => openDecisions.push(d),
    });
    const outOpen = await runMiddleware(guardOpen);
    assert.equal(outOpen.nextCalled, true);
    assert.equal(openDecisions[0].decision, 'ALLOW');
    assert.equal(openDecisions[0].fallback, true);
    assert.equal(openDecisions[0].fallback_reason, 'timeout');
    assert.equal(openDecisions[0].meta.source, 'sdk_fallback');

    const closedDecisions = [];
    const guardClosed = identityGuard({
      client,
      scope: 'login',
      failOpen: false,
      getSubject: () => ({ user_id: 'u1' }),
      onDecision: (d) => closedDecisions.push(d),
    });
    const outClosed = await runMiddleware(guardClosed);
    assert.equal(outClosed.nextCalled, false);
    assert.equal(outClosed.statusCode, 403);
    assert.equal(closedDecisions[0].decision, 'BLOCK');
    assert.equal(closedDecisions[0].fallback, true);
    assert.equal(closedDecisions[0].fallback_reason, 'timeout');
    assert.equal(closedDecisions[0].meta.source, 'sdk_fallback');

    await closeActiveServer();
    closeActiveServer = null;

    // Slow body after 200 headers must also respect total deadline
    const slowBodyServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"decision":"ALLOW"');
      const timer = setTimeout(() => {
        if (!res.writableEnded) {
          res.end('}');
        }
      }, 250);
      timer.unref();
    });
    await new Promise((resolve) => slowBodyServer.listen(0, '127.0.0.1', resolve));
    closeActiveServer = () =>
      new Promise((done) => {
        slowBodyServer.closeAllConnections?.();
        slowBodyServer.close(() => done());
      });
    const { port: slowPort } = slowBodyServer.address();
    const slowBodyClient = makeClient(`http://127.0.0.1:${slowPort}`, { identityTimeoutMs: 45 });
    const bodyErr = await slowBodyClient.identity
      .evaluate({ scope: 'login', subject: { user_id: 'u1' } })
      .catch((e) => e);
    assert.ok(bodyErr instanceof IdentityTransientError);
    assert.equal(bodyErr.reason, 'timeout');
  });

  it('handles network error with single retry and guard fallback', async () => {
    let calls = 0;
    const netClient = new GeoEngine('sk_test_super_secret_key_value', {
      apiServiceUrl: 'http://127.0.0.1:1',
      identityTimeoutMs: 250,
      fetch: async () => {
        calls++;
        throw new TypeError('fetch failed: ECONNREFUSED sk_test_super_secret_key_value');
      },
    });

    const err = await netClient.identity
      .evaluate({ scope: 'login', subject: { user_id: 'u1' } })
      .catch((e) => e);
    assert.ok(err instanceof IdentityTransientError);
    assert.equal(err.reason, 'network');
    assert.equal(calls, 2);
    assert.equal(err.message.includes('sk_test_super_secret_key_value'), false);

    const decisions = [];
    const out = await runMiddleware(
      identityGuard({
        client: netClient,
        scope: 'login',
        failOpen: true,
        getSubject: () => ({ user_id: 'u1' }),
        onDecision: (d) => decisions.push(d),
      })
    );
    assert.equal(out.nextCalled, true);
    assert.equal(decisions[0].fallback, true);
    assert.equal(decisions[0].fallback_reason, 'network');
    assert.equal(decisions[0].meta.source, 'sdk_fallback');
  });

  it('treats unexpected 200 payload shape as IdentityIntegrationError without failOpen', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ decision: 'ALLOW' })); // missing required fields
    });

    const client = makeClient(mock.url);
    const err = await client.identity
      .evaluate({ scope: 'login', subject: { user_id: 'u1' } })
      .catch((e) => e);

    assert.ok(err instanceof IdentityIntegrationError);
    assert.equal(err.reason, 'unexpected_response');
    assert.equal(err.status, 200);
    assert.equal(mock.captured.length, 1);

    const out = await runMiddleware(
      identityGuard({
        client,
        scope: 'login',
        failOpen: true,
        getSubject: () => ({ user_id: 'u1' }),
      })
    );
    assert.equal(out.nextCalled, false);
    assert.equal(out.statusCode, 500);
    assert.deepEqual(out.body, { error: 'internal_error' });
  });

  it('retries 5xx once successfully and applies failOpen when retry also fails', async () => {
    const mock = await startMockServer((_req, res, attempt) => {
      if (attempt === 1) {
        res.writeHead(503, { 'Content-Type': 'application/problem+json' });
        res.end(
          JSON.stringify({
            type: 'urn:geoengine:problem:unavailable',
            title: 'Service Unavailable',
            status: 503,
            detail: 'postgres timeout',
            request_id: 'srv_req_1',
          })
        );
        return;
      }
      if (attempt === 2) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            decision: 'ALLOW',
            matched_rule: null,
            default_applied: true,
            reason: 'DEFAULT_ACTION',
            signals: [],
            shadow_matches: [],
            meta: {
              config_version: 1,
              stale: false,
              config_age_s: 0,
              source: 'postgres',
              evaluated_at: '2026-11-20T18:30:00.000Z',
            },
          })
        );
        return;
      }
      res.writeHead(503, { 'Content-Type': 'application/problem+json' });
      res.end(
        JSON.stringify({
          type: 'urn:geoengine:problem:unavailable',
          title: 'Service Unavailable',
          status: 503,
          detail: 'db down',
        })
      );
    });

    const client = makeClient(mock.url, { identityTimeoutMs: 500 });
    const recovered = await client.identity.evaluate({
      scope: 'login',
      subject: { user_id: 'u1' },
    });
    assert.equal(recovered.decision, 'ALLOW');
    assert.equal(mock.captured.length, 2);

    const openDecisions = [];
    const outOpen = await runMiddleware(
      identityGuard({
        client,
        scope: 'login',
        failOpen: true,
        getSubject: () => ({ user_id: 'u1' }),
        onDecision: (d) => openDecisions.push(d),
      })
    );
    assert.equal(outOpen.nextCalled, true);
    assert.equal(mock.captured.length, 4);
    assert.equal(openDecisions[0].decision, 'ALLOW');
    assert.equal(openDecisions[0].fallback, true);
    assert.equal(openDecisions[0].fallback_reason, 'server_error');
    assert.equal(openDecisions[0].meta.source, 'sdk_fallback');

    const closedDecisions = [];
    const outClosed = await runMiddleware(
      identityGuard({
        client,
        scope: 'login',
        failOpen: false,
        getSubject: () => ({ user_id: 'u1' }),
        onDecision: (d) => closedDecisions.push(d),
      })
    );
    assert.equal(outClosed.nextCalled, false);
    assert.equal(outClosed.statusCode, 403);
    assert.equal(closedDecisions[0].decision, 'BLOCK');
    assert.equal(closedDecisions[0].fallback_reason, 'server_error');
  });

  it('treats non-JSON 502 as IdentityTransientError without exposing raw body', async () => {
    const rawHtml = '<html><body><h1>502 Bad Gateway Internal Upstream Host 10.0.0.5</h1></body></html>';
    const mock = await startMockServer((_req, res) => {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end(rawHtml);
    });

    const client = makeClient(mock.url, { identityTimeoutMs: 300 });
    const err = await client.identity
      .evaluate({ scope: 'login', subject: { user_id: 'u1' } })
      .catch((e) => e);

    assert.ok(err instanceof IdentityTransientError);
    assert.equal(isTransient(err), true);
    assert.equal(err.status, 502);
    assert.equal(err.reason, 'server_error');
    assert.equal(err.message.includes('Bad Gateway'), false);
    assert.equal(err.message.includes('10.0.0.5'), false);
    assert.equal(err.detail, undefined);
    assert.equal(mock.captured.length, 2);
  });

  it('handles 429 without Retry-After and with Retry-After (fits vs exceeds deadline)', async () => {
    // 1) Without Retry-After -> jitter retry succeeds
    const mockNoHeader = await startMockServer((_req, res, attempt) => {
      if (attempt === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate limit' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          decision: 'ALLOW',
          matched_rule: null,
          default_applied: true,
          reason: 'DEFAULT_ACTION',
          signals: [],
          shadow_matches: [],
          meta: {
            config_version: 1,
            stale: false,
            config_age_s: 0,
            source: 'postgres',
            evaluated_at: '2026-11-20T18:30:00.000Z',
          },
        })
      );
    });

    const client1 = makeClient(mockNoHeader.url, { identityTimeoutMs: 500 });
    const res1 = await client1.identity.evaluate({ scope: 'login', subject: { user_id: 'u1' } });
    assert.equal(res1.decision, 'ALLOW');
    assert.equal(mockNoHeader.captured.length, 2);
    await closeActiveServer();
    closeActiveServer = null;

    // 2) Retry-After: 0 fits in deadline -> retries once and succeeds
    const mockFits = await startMockServer((_req, res, attempt) => {
      if (attempt === 1) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '0',
        });
        res.end('{}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          decision: 'ALLOW',
          matched_rule: null,
          default_applied: true,
          reason: 'DEFAULT_ACTION',
          signals: [],
          shadow_matches: [],
          meta: {
            config_version: 1,
            stale: false,
            config_age_s: 0,
            source: 'postgres',
            evaluated_at: '2026-11-20T18:30:00.000Z',
          },
        })
      );
    });

    const client2 = makeClient(mockFits.url, { identityTimeoutMs: 500 });
    const res2 = await client2.identity.evaluate({ scope: 'login', subject: { user_id: 'u1' } });
    assert.equal(res2.decision, 'ALLOW');
    assert.equal(mockFits.captured.length, 2);
    await closeActiveServer();
    closeActiveServer = null;

    // 3) Retry-After: 60 exceeds deadline -> fails fast as transient with 1 request
    const mockTooLong = await startMockServer((_req, res) => {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': '60',
      });
      res.end('{}');
    });

    const client3 = makeClient(mockTooLong.url, { identityTimeoutMs: 150 });
    const started = Date.now();
    const err3 = await client3.identity
      .evaluate({ scope: 'login', subject: { user_id: 'u1' } })
      .catch((e) => e);
    const elapsed = Date.now() - started;

    assert.ok(err3 instanceof IdentityTransientError);
    assert.equal(err3.status, 429);
    assert.equal(err3.reason, 'rate_limited');
    assert.equal(mockTooLong.captured.length, 1);
    assert.ok(elapsed < 150, `Expected fail fast, took ${elapsed}ms`);
  });

  it('throws IdentityIntegrationError on 401, edge 403, 422 scope-not-found, 400, and guard never applies failOpen', async () => {
    const cases = [
      {
        name: '401 unauthorized',
        status: 401,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'urn:geoengine:problem:unauthorized',
          title: 'Unauthorized',
          status: 401,
          detail: 'Invalid bearer key',
        }),
        expectedReason: 'unauthorized',
      },
      {
        name: '403 edge non-problem+json',
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'missing custom origin header internal-secret' }),
        expectedReason: 'edge_forbidden',
        expectedMessagePart: 'bloqueado en el borde',
      },
      {
        name: '422 scope-not-found',
        status: 422,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'urn:geoengine:problem:scope-not-found',
          title: 'Scope Not Found',
          status: 422,
          detail: 'Unknown scope slug',
        }),
        expectedReason: 'scope_not_found',
      },
      {
        name: '400 malformed-request',
        status: 400,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'urn:geoengine:problem:malformed-request',
          title: 'Malformed Request',
          status: 400,
          detail: 'Invalid X-Request-Id',
        }),
        expectedReason: 'malformed_request',
      },
    ];

    for (const tc of cases) {
      const mock = await startMockServer((_req, res) => {
        res.writeHead(tc.status, { 'Content-Type': tc.contentType });
        res.end(tc.body);
      });

      const client = makeClient(mock.url);
      const err = await client.identity
        .evaluate({ scope: 'login', subject: { user_id: 'u1' } })
        .catch((e) => e);

      assert.ok(err instanceof IdentityIntegrationError, `${tc.name}: expected IdentityIntegrationError`);
      assert.ok(err instanceof RootIntegrationError);
      assert.ok(err instanceof cjsIdentity.IdentityIntegrationError);
      assert.equal(isTransient(err), false);
      assert.equal(err.status, tc.status);
      assert.equal(err.reason, tc.expectedReason);
      assert.equal(mock.captured.length, 1, `${tc.name}: must never retry 4xx`);
      if (tc.expectedMessagePart) {
        assert.ok(err.message.toLowerCase().includes(tc.expectedMessagePart));
        assert.equal(err.message.includes('internal-secret'), false);
      }

      let hookErr = null;
      const guard = identityGuard({
        client,
        scope: 'login',
        failOpen: true,
        getSubject: () => ({ user_id: 'u1' }),
        onIntegrationError: (e) => {
          hookErr = e;
        },
      });
      const out = await runMiddleware(guard);
      assert.equal(out.nextCalled, false, `${tc.name}: failOpen must NOT allow integration errors`);
      assert.equal(out.statusCode, 500);
      assert.deepEqual(out.body, { error: 'internal_error' });
      assert.ok(hookErr instanceof IdentityIntegrationError);

      await closeActiveServer();
      closeActiveServer = null;
    }
  });

  it('performs minimal local validation and lets server enforce scope pattern (422)', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(422, { 'Content-Type': 'application/problem+json' });
      res.end(
        JSON.stringify({
          type: 'urn:geoengine:problem:invalid-request',
          title: 'Invalid Request',
          status: 422,
          detail: 'scope does not match pattern',
        })
      );
    });

    const client = makeClient(mock.url);

    await assert.rejects(
      client.identity.evaluate({ scope: '   ', subject: { user_id: 'u1' } }),
      (err) => err instanceof IdentityIntegrationError && err.reason === 'invalid_request'
    );
    await assert.rejects(
      client.identity.evaluate({ scope: 'login', subject: {} }),
      (err) => err instanceof IdentityIntegrationError && err.reason === 'invalid_request'
    );
    assert.equal(mock.captured.length, 0);

    // Invalid pattern goes to server and maps 422
    const err = await client.identity
      .evaluate({ scope: 'INVALID SCOPE!', subject: { user_id: 'u1' } })
      .catch((e) => e);
    assert.ok(err instanceof IdentityIntegrationError);
    assert.equal(err.status, 422);
    assert.equal(mock.captured.length, 1);
  });

  it('treats CHALLENGE without onChallenge as BLOCK (403 challenge_required)', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          decision: 'CHALLENGE',
          matched_rule: { id: 'r1', name: 'Step up', priority: 1 },
          default_applied: false,
          reason: 'RULE_MATCH',
          signals: ['outside_geo_limit'],
          shadow_matches: [],
          challenge: { hint: 'step_up' },
          meta: {
            config_version: 2,
            stale: false,
            config_age_s: 0,
            source: 'postgres',
            evaluated_at: '2026-11-20T18:30:00.000Z',
          },
        })
      );
    });

    const client = makeClient(mock.url);
    const guard = identityGuard({
      client,
      scope: 'login',
      failOpen: true,
      getSubject: () => ({ user_id: 'u1' }),
    });

    const out = await runMiddleware(guard);
    assert.equal(out.nextCalled, false);
    assert.equal(out.statusCode, 403);
    assert.deepEqual(out.body, { error: 'challenge_required', hint: 'step_up' });
  });

  it('treats unknown decision value as transient fallback and ignores unknown fields', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          decision: 'QUARANTINE_FUTURE',
          matched_rule: null,
          default_applied: false,
          reason: 'FUTURE_REASON',
          signals: ['future_signal_v2'],
          shadow_matches: [],
          future_top_level_field: { ignored: true },
          meta: {
            config_version: 99,
            stale: false,
            config_age_s: 0,
            source: 'redis',
            evaluated_at: '2026-11-20T18:30:00.000Z',
            request_id: 'req_unknown_dec',
            reputation: 'future_rep_value',
            future_meta_field: 123,
          },
        })
      );
    });

    const client = makeClient(mock.url);
    const evaluated = await client.identity.evaluate({
      scope: 'login',
      subject: { user_id: 'u1' },
    });
    assert.equal(evaluated.decision, 'QUARANTINE_FUTURE');
    assert.deepEqual(evaluated.signals, ['future_signal_v2']);
    assert.equal(evaluated.meta.reputation, 'future_rep_value');
    assert.equal(mock.captured.length, 1);

    const openDecisions = [];
    const outOpen = await runMiddleware(
      identityGuard({
        client,
        scope: 'login',
        failOpen: true,
        getSubject: () => ({ user_id: 'u1' }),
        onDecision: (d) => openDecisions.push(d),
      })
    );
    assert.equal(outOpen.nextCalled, true);
    assert.equal(openDecisions[0].decision, 'ALLOW');
    assert.equal(openDecisions[0].fallback, true);
    assert.equal(openDecisions[0].fallback_reason, 'unknown_decision');
    assert.equal(openDecisions[0].meta.source, 'sdk_fallback');

    const outClosed = await runMiddleware(
      identityGuard({
        client,
        scope: 'login',
        failOpen: false,
        getSubject: () => ({ user_id: 'u1' }),
      })
    );
    assert.equal(outClosed.nextCalled, false);
    assert.equal(outClosed.statusCode, 403);
  });

  it('sends Bearer + X-Request-Id (reused on retry, included in errors), omits legacy headers, and never leaks apiKey', async () => {
    const mock = await startMockServer((req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/problem+json' });
      res.end(
        JSON.stringify({
          type: 'urn:geoengine:problem:unavailable',
          title: 'Unavailable',
          status: 503,
          detail: `echoed sk_test_super_secret_key_value`,
          request_id: req.headers['x-request-id'],
        })
      );
    });

    const client = makeClient(mock.url, { identityTimeoutMs: 400 });

    assert.equal('apiKey' in client.options, false);
    assert.equal(JSON.stringify(client).includes('sk_test_super_secret_key_value'), false);
    assert.equal(inspect(client).includes('sk_test_super_secret_key_value'), false);

    const err = await client.identity
      .evaluate({ scope: 'login', subject: { user_id: 'u1' } })
      .catch((e) => e);

    assert.equal(mock.captured.length, 2);
    const req1 = mock.captured[0];
    const req2 = mock.captured[1];

    assert.equal(req1.headers['authorization'], 'Bearer sk_test_super_secret_key_value');
    assert.ok(req1.headers['x-request-id']);
    assert.equal(req1.headers['x-request-id'], req2.headers['x-request-id']);
    assert.equal(req1.headers['x-signature'], undefined);
    assert.equal(req1.headers['x-request-time'], undefined);
    assert.equal(req1.headers['x-api-key'], undefined);
    assert.equal(req1.headers['x-geo-environment'], undefined);

    assert.equal(err.requestId, req1.headers['x-request-id']);
    assert.equal(err.message.includes('sk_test_super_secret_key_value'), false);
    assert.equal(err.detail.includes('sk_test_super_secret_key_value'), false);
    assert.equal(JSON.stringify(err).includes('sk_test_super_secret_key_value'), false);
    assert.equal(inspect(err).includes('sk_test_super_secret_key_value'), false);
  });

  it('requires failOpen at runtime and blocks browser/window usage with a clear error', async () => {
    const client = makeClient('http://127.0.0.1:9999');

    assert.throws(
      () =>
        identityGuard({
          client,
          scope: 'login',
          getSubject: () => ({ user_id: 'u1' }),
        }),
      (err) => err instanceof IdentityIntegrationError && err.reason === 'configuration_error'
    );

    // Check CJS entrypoint loads cleanly on server
    assert.equal(typeof cjsIdentity.identityGuard, 'function');
    assert.equal(typeof cjsRoot.GeoEngine, 'function');

    // Simulate browser environment
    globalThis.window = {};
    await assert.rejects(
      client.identity.evaluate({ scope: 'login', subject: { user_id: 'u1' } }),
      (err) => /servidor|navegador|secreta|CORS/i.test(err.message)
    );
    assert.throws(
      () =>
        identityGuard({
          client,
          scope: 'login',
          failOpen: false,
          getSubject: () => ({ user_id: 'u1' }),
        }),
      (err) => /servidor|navegador|secreta|CORS/i.test(err.message)
    );
    await assert.rejects(
      import('../dist/identity.js?browser-check=1'),
      (err) => /servidor|navegador|secreta|CORS/i.test(err.message)
    );
  });
});
