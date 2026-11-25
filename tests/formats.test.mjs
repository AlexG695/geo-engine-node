import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import * as esmRoot from '../dist/index.js';
import * as esmIdentity from '../dist/identity.js';

const require = createRequire(import.meta.url);
const cjsRoot = require('../dist/index.cjs');
const cjsIdentity = require('../dist/identity.cjs');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const formats = [
  ['ESM', esmRoot, esmIdentity],
  ['CJS', cjsRoot, cjsIdentity],
];

describe('shared error classes per format', () => {
  for (const [name, root, identity] of formats) {
    it(`${name}: both entry points share one instance of the error classes`, () => {
      assert.equal(identity.IdentityIntegrationError, root.IdentityIntegrationError);
      assert.equal(identity.IdentityTransientError, root.IdentityTransientError);

      const integration = new identity.IdentityIntegrationError({ message: 'x', reason: 'invalid_request' });
      const transient = new identity.IdentityTransientError({ message: 'x', reason: 'timeout' });
      assert.ok(integration instanceof root.GeoEngineError);
      assert.ok(integration instanceof Error);
      assert.ok(transient instanceof root.GeoEngineError);
      assert.ok(root.isTransient(transient));
      assert.ok(!root.isTransient(integration));
    });

    it(`${name}: err.code is stable`, () => {
      const integration = new identity.IdentityIntegrationError({ message: 'x', reason: 'invalid_request' });
      const transient = new identity.IdentityTransientError({ message: 'x', reason: 'timeout' });
      assert.equal(integration.code, 'IDENTITY_INTEGRATION');
      assert.equal(transient.code, 'IDENTITY_TRANSIENT');
      assert.equal(new root.ValidationError('x').name, 'ValidationError');
      assert.equal(new root.SpatialAPIError(400, 'BAD', 'm').code, 'BAD');
    });
  }

  it('err.code is identical across ESM and CJS (the cross-format contract)', () => {
    const a = new esmIdentity.IdentityIntegrationError({ message: 'x', reason: 'invalid_request' });
    const b = new cjsIdentity.IdentityIntegrationError({ message: 'x', reason: 'invalid_request' });
    assert.equal(a.code, b.code);
    assert.equal(a.name, b.name);
  });
});

describe('User-Agent', () => {
  for (const [name, root] of formats) {
    it(`${name}: contains the package.json version`, async () => {
      let ua;
      const server = createServer((req, res) => {
        ua = req.headers['user-agent'];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      try {
        const { port } = server.address();
        const client = new root.GeoEngine('k-test', { baseUrl: `http://127.0.0.1:${port}`, maxRetries: 0 });
        await client.sendLocation('truck-1', 19.4, -99.1).catch(() => {});
      } finally {
        server.closeAllConnections?.();
        await new Promise((r) => server.close(r));
      }
      assert.equal(ua, `GeoEngineNodeSDK/${pkg.version}`);
    });
  }
});

describe('identity.evaluate redirects', () => {
  it('does not follow a redirect to another origin', async () => {
    let targetHits = 0;
    const target = createServer((_req, res) => {
      targetHits++;
      res.end('{}');
    });
    await new Promise((r) => target.listen(0, '127.0.0.1', r));
    const origin = createServer((_req, res) => {
      res.writeHead(307, { Location: `http://127.0.0.1:${target.address().port}/x` });
      res.end();
    });
    await new Promise((r) => origin.listen(0, '127.0.0.1', r));
    try {
      const client = new esmRoot.GeoEngine('k-test', {
        baseUrl: `http://127.0.0.1:${origin.address().port}`,
      });
      await assert.rejects(
        client.identity.evaluate({ scope: 'login', subject: { user_id: 'u1' }, context: { ip: '203.0.113.42' } }),
      );
      assert.equal(targetHits, 0);
    } finally {
      for (const s of [origin, target]) {
        s.closeAllConnections?.();
        await new Promise((r) => s.close(r));
      }
    }
  });
});

describe('published artifacts', () => {
  it('sourcemaps contain no absolute or local paths', async () => {
    const { readdirSync } = await import('node:fs');
    const { isAbsolute } = await import('node:path');
    const dist = new URL('../dist/', import.meta.url);
    const maps = readdirSync(dist).filter((f) => f.endsWith('.map'));
    assert.ok(maps.length > 0);
    for (const name of maps) {
      const raw = readFileSync(new URL(name, dist), 'utf8');
      const map = JSON.parse(raw);
      assert.ok(!map.file || !isAbsolute(map.file), `${name}: absolute "file"`);
      for (const src of map.sources) assert.ok(!isAbsolute(src), `${name}: absolute source`);
      assert.ok(!raw.includes(process.cwd()), `${name}: contains the working directory`);
      assert.ok(!raw.includes('/home/'), `${name}: contains /home/`);
    }
  });
});
