import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APIError,
  ClientClosedError,
  DeviceIDRequiredError,
  GeoEngine,
  generateHMACSignature,
  InvalidCoordinatesError,
  TimeoutError,
  ValidationError,
} from '../src/index.js';

interface TestServer {
  server: Server;
  url: string;
  close: () => Promise<void>;
}

function startTestServer(
  handler: (req: any, res: any, body: string) => void
): Promise<TestServer> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        handler(req, res, body);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        url,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

describe('GeoEngine Client (Table-Driven)', () => {
  let activeServer: TestServer | null = null;

  afterEach(async () => {
    if (activeServer) {
      await activeServer.close();
      activeServer = null;
    }
  });

  describe('sendLocation', () => {
    it('successfully sends location with correct headers and payload', async () => {
      let capturedRequest: any = null;
      let capturedBody: any = null;

      activeServer = await startTestServer((req, res, body) => {
        capturedRequest = req;
        capturedBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, processed_count: 1 }));
      });

      const client = new GeoEngine('sk_test_api_key', {
        ingestUrl: activeServer.url,
      });

      await client.sendLocation('truck-101', 19.4326, -99.1332);

      expect(capturedRequest.url).toBe('/ingest');
      expect(capturedRequest.method).toBe('POST');
      expect(capturedRequest.headers['content-type']).toBe('application/json');
      expect(capturedRequest.headers['x-api-key']).toBe('sk_test_api_key');
      expect(capturedRequest.headers['x-geo-environment']).toBe('live');
      expect(capturedRequest.headers['x-request-time']).toBeDefined();
      expect(capturedRequest.headers['x-signature']).toBeDefined();
      expect(capturedRequest.headers['user-agent']).toContain('GeoEngineNodeSDK');

      expect(capturedBody.device_id).toBe('truck-101');
      expect(capturedBody.latitude).toBe(19.4326);
      expect(capturedBody.longitude).toBe(-99.1332);
      expect(capturedBody.timestamp).toBeGreaterThan(0);
    });

    it('includes JWT Bearer authorization header when configured', async () => {
      let authHeader: string | undefined;

      activeServer = await startTestServer((req, res) => {
        authHeader = req.headers['authorization'];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });

      const client = new GeoEngine('sk_key', {
        ingestUrl: activeServer.url,
        jwtToken: 'jwt.token.abc',
      });

      await client.sendLocation('device-jwt', 40.7128, -74.006);
      expect(authHeader).toBe('Bearer jwt.token.abc');
    });

    it('throws DeviceIDRequiredError when deviceId is missing or empty', async () => {
      const client = new GeoEngine('sk_key');

      await expect(client.sendLocation('', 19.43, -99.13)).rejects.toThrow(
        DeviceIDRequiredError
      );
      await expect(client.sendLocation('   ', 19.43, -99.13)).rejects.toThrow(
        DeviceIDRequiredError
      );
    });

    it('throws APIError on HTTP 400 Bad Request', async () => {
      activeServer = await startTestServer((_req, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid coordinates' }));
      });

      const client = new GeoEngine('sk_key', {
        ingestUrl: activeServer.url,
        maxRetries: 0,
      });

      await expect(
        client.sendLocation('dev-err', 0, 0)
      ).rejects.toThrow(APIError);
    });

    it('throws APIError on HTTP 500 Internal Server Error', async () => {
      activeServer = await startTestServer((_req, res) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('internal server failure');
      });

      const client = new GeoEngine('sk_key', {
        ingestUrl: activeServer.url,
        maxRetries: 0,
      });

      await expect(
        client.sendLocation('dev-500', 10, 20)
      ).rejects.toThrow(APIError);
    });

    it('throws TimeoutError when request exceeds timeout limit', async () => {
      activeServer = await startTestServer((_req, res) => {
        setTimeout(() => {
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        }, 100);
      });

      const client = new GeoEngine('sk_key', {
        ingestUrl: activeServer.url,
        timeout: 20,
        maxRetries: 0,
      });

      await expect(
        client.sendLocation('dev-slow', 1, 1)
      ).rejects.toThrow(TimeoutError);
    });
  });

  describe('createGeofence', () => {
    it('creates geofence polygon with auto-closure and correct GeoJSON format', async () => {
      let capturedBody: any = null;

      activeServer = await startTestServer((req, res, body) => {
        expect(req.url).toBe('/geofences');
        capturedBody = JSON.parse(body);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'geo-123', status: 'active' }));
      });

      const client = new GeoEngine('sk_key', {
        managementUrl: activeServer.url,
      });

      const coordinates: [number, number][] = [
        [19.43, -99.13],
        [19.44, -99.13],
        [19.44, -99.12],
      ];

      await client.createGeofence(
        'Downtown Zone',
        coordinates,
        'https://example.com/webhook'
      );

      expect(capturedBody.name).toBe('Downtown Zone');
      expect(capturedBody.webhook_url).toBe('https://example.com/webhook');
      expect(capturedBody.geojson.type).toBe('Polygon');

      // 3 input points should be closed into 4 GeoJSON points [lng, lat]
      const geojsonCoords = capturedBody.geojson.coordinates[0];
      expect(geojsonCoords).toHaveLength(4);
      expect(geojsonCoords[0]).toEqual([-99.13, 19.43]);
      expect(geojsonCoords[3]).toEqual([-99.13, 19.43]);
    });

    it('throws InvalidCoordinatesError if fewer than 3 coordinates are provided', async () => {
      const client = new GeoEngine('sk_key');

      const invalidCoords: [number, number][] = [
        [19.43, -99.13],
        [19.44, -99.13],
      ];

      await expect(
        client.createGeofence('Line', invalidCoords)
      ).rejects.toThrow(InvalidCoordinatesError);
    });

    it('throws ValidationError when geofence name is missing', async () => {
      const client = new GeoEngine('sk_key');
      const coords: [number, number][] = [
        [19.43, -99.13],
        [19.44, -99.13],
        [19.44, -99.12],
      ];

      await expect(client.createGeofence('', coords)).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe('Client Options and baseUrl', () => {
    it('sets options and baseUrl correctly', () => {
      const client = new GeoEngine('api-key-xyz', {
        environment: 'test',
        jwtToken: 'jwt-token',
        baseUrl: 'https://mock-base.com',
        timeout: 4000,
        batchSize: 200,
        flushInterval: 250,
      });

      expect(client.options.apiKey).toBe('api-key-xyz');
      expect(client.options.environment).toBe('test');
      expect(client.options.jwtToken).toBe('jwt-token');
      expect(client.options.ingestUrl).toBe('https://mock-base.com');
      expect(client.options.managementUrl).toBe('https://mock-base.com');
      expect(client.options.apiServiceUrl).toBe('https://mock-base.com');
      expect(client.options.timeout).toBe(4000);
      expect(client.options.batchSize).toBe(200);
      expect(client.options.flushInterval).toBe(250);
    });

    it('throws if apiKey is missing in constructor', () => {
      expect(() => new GeoEngine('')).toThrow(ValidationError);
      expect(() => new GeoEngine({ apiKey: '' })).toThrow(ValidationError);
    });
  });

  describe('Client Close Lifecycle', () => {
    it('throws ClientClosedError after close()', async () => {
      const client = new GeoEngine('test-key');
      client.close();

      // Idempotent close
      expect(() => client.close()).not.toThrow();

      await expect(
        client.sendLocation('dev-closed', 10, 20)
      ).rejects.toThrow(ClientClosedError);

      await expect(
        client.createGeofence('Fence', [
          [10, 20],
          [11, 20],
          [11, 21],
        ])
      ).rejects.toThrow(ClientClosedError);

      await expect(
        client.validateSpatialPoint('geo-1', 10, 20)
      ).rejects.toThrow(ClientClosedError);
    });
  });

  describe('HMAC Signature Generation', () => {
    it('generates deterministic 64-char hex SHA-256 signature', () => {
      const sig1 = generateHMACSignature('my-secret-key', 1700000000000);
      const sig2 = generateHMACSignature('my-secret-key', 1700000000000);
      const sig3 = generateHMACSignature('other-key', 1700000000000);

      expect(sig1).toHaveLength(64);
      expect(sig1).toBe(sig2);
      expect(sig1).not.toBe(sig3);
    });
  });
});
