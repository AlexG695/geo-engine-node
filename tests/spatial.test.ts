import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  GeofenceIDRequiredError,
  GeofenceNotFoundError,
  GeoEngine,
  InvalidLatitudeError,
  InvalidLongitudeError,
  QuotaExceededError,
  SpatialGeneralResult,
  SpatialValidationResult,
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

describe('Spatial Module & Point Validation (Table-Driven)', () => {
  let activeServer: TestServer | null = null;

  afterEach(async () => {
    if (activeServer) {
      await activeServer.close();
      activeServer = null;
    }
  });

  describe('validatePoint', () => {
    it('successfully validates point inside geofence', async () => {
      let capturedBody: any = null;

      activeServer = await startTestServer((req, res, body) => {
        expect(req.url).toBe('/api/spatial/validate');
        expect(req.method).toBe('POST');
        expect(req.headers['x-api-key']).toBe('test-spatial-key');
        expect(req.headers['x-geo-environment']).toBe('live');

        capturedBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              inside: true,
              geofence_id: 'geo-cdmx-centro',
              geofence_name: 'Zona Centro',
              latitude: 19.4326,
              longitude: -99.1332,
            },
          })
        );
      });

      const client = new GeoEngine('test-spatial-key', {
        apiServiceUrl: activeServer.url,
      });

      const res = await client.spatial.validatePoint(
        'geo-cdmx-centro',
        19.4326,
        -99.1332
      );

      expect(capturedBody.geofence_id).toBe('geo-cdmx-centro');
      expect(capturedBody.latitude).toBe(19.4326);
      expect(capturedBody.longitude).toBe(-99.1332);

      expect(res).toBeInstanceOf(SpatialValidationResult);
      expect(res.isInside()).toBe(true);
      expect(res.isOutside()).toBe(false);
      expect(res.geofenceName).toBe('Zona Centro');
      expect(res.coordinates()).toEqual([19.4326, -99.1332]);
      expect(res.toString()).toContain('[INSIDE] geofence=geo-cdmx-centro (Zona Centro)');
    });

    it('returns point outside geofence', async () => {
      activeServer = await startTestServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              inside: false,
              geofence_id: 'geo-cdmx-centro',
              geofence_name: 'Zona Centro',
              latitude: 25.6866,
              longitude: -100.3161,
            },
          })
        );
      });

      const client = new GeoEngine('test-key', {
        apiServiceUrl: activeServer.url,
      });

      const res = await client.spatial.validatePoint(
        'geo-cdmx-centro',
        25.6866,
        -100.3161
      );

      expect(res.isInside()).toBe(false);
      expect(res.isOutside()).toBe(true);
      expect(res.toString()).toContain('[OUTSIDE]');
    });

    it('throws GeofenceIDRequiredError on empty geofence ID', async () => {
      const client = new GeoEngine('test-key');

      await expect(
        client.spatial.validatePoint('   ', 19.4326, -99.1332)
      ).rejects.toThrow(GeofenceIDRequiredError);
    });

    it('throws InvalidLatitudeError when latitude is out of range', async () => {
      const client = new GeoEngine('test-key');

      await expect(
        client.spatial.validatePoint('geo-1', 95.5, -99.1332)
      ).rejects.toThrow(InvalidLatitudeError);

      await expect(
        client.spatial.validatePoint('geo-1', -95.5, -99.1332)
      ).rejects.toThrow(InvalidLatitudeError);
    });

    it('throws InvalidLongitudeError when longitude is out of range', async () => {
      const client = new GeoEngine('test-key');

      await expect(
        client.spatial.validatePoint('geo-1', 19.4326, 185.0)
      ).rejects.toThrow(InvalidLongitudeError);

      await expect(
        client.spatial.validatePoint('geo-1', 19.4326, -185.0)
      ).rejects.toThrow(InvalidLongitudeError);
    });

    it('maps HTTP 204 No Content to GeofenceNotFoundError', async () => {
      activeServer = await startTestServer((_req, res) => {
        res.writeHead(204);
        res.end();
      });

      const client = new GeoEngine('test-key', {
        apiServiceUrl: activeServer.url,
      });

      await expect(
        client.spatial.validatePoint('geo-nonexistent', 19.4326, -99.1332)
      ).rejects.toThrow(GeofenceNotFoundError);
    });

    it('maps HTTP 402 Payment Required to QuotaExceededError', async () => {
      activeServer = await startTestServer((_req, res) => {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: {
              code: 402,
              message: 'Límite de peticiones alcanzado',
              status: 'Payment Required',
              details: [{ reason: 'QUOTA_EXCEEDED' }],
            },
          })
        );
      });

      const client = new GeoEngine('test-key', {
        apiServiceUrl: activeServer.url,
      });

      const promise = client.spatial.validatePoint('geo-1', 19.4326, -99.1332);
      await expect(promise).rejects.toThrow(QuotaExceededError);
      await promise.catch((err) => {
        expect(err.isQuotaExceeded()).toBe(true);
      });
    });

    it('maps HTTP 401 Unauthorized to AuthenticationError', async () => {
      activeServer = await startTestServer((_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: {
              code: 401,
              message: 'Se requiere una clave de API válida',
              status: 'Unauthorized',
              details: [{ reason: 'MISSING_API_KEY' }],
            },
          })
        );
      });

      const client = new GeoEngine('test-key', {
        apiServiceUrl: activeServer.url,
      });

      const promise = client.spatial.validatePoint('geo-1', 19.4326, -99.1332);
      await expect(promise).rejects.toThrow(AuthenticationError);
      await promise.catch((err) => {
        expect(err.isUnauthorized()).toBe(true);
      });
    });
  });

  describe('validateGeneral', () => {
    it('successfully processes point matching multiple geofences', async () => {
      activeServer = await startTestServer((req, res) => {
        expect(req.url).toBe('/api/spatial/validate-general');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              inside: true,
              total_matches: 2,
              matched_geofences: [
                { id: 'geo-1', name: 'Zona Norte' },
                { id: 'geo-2', name: 'Distrito Federal' },
              ],
              latitude: 19.4326,
              longitude: -99.1332,
            },
          })
        );
      });

      const client = new GeoEngine('test-key', {
        apiServiceUrl: activeServer.url,
      });

      const res = await client.spatial.validateGeneral(19.4326, -99.1332);

      expect(res).toBeInstanceOf(SpatialGeneralResult);
      expect(res.isInside()).toBe(true);
      expect(res.hasMatches()).toBe(true);
      expect(res.totalMatches).toBe(2);
      expect(res.firstMatch()).toEqual({ id: 'geo-1', name: 'Zona Norte' });
      expect(res.geofenceIds()).toEqual(['geo-1', 'geo-2']);
      expect(res.geofenceNames()).toEqual(['Zona Norte', 'Distrito Federal']);

      expect(res.containsGeofence('geo-1')).toBe(true);
      expect(res.containsGeofence('Distrito Federal')).toBe(true);
      expect(res.containsGeofence('geo-inexistente')).toBe(false);

      expect(res.findMatch('geo-2')).toEqual({
        id: 'geo-2',
        name: 'Distrito Federal',
      });
      expect(res.findMatch('Zona Norte')).toEqual({
        id: 'geo-1',
        name: 'Zona Norte',
      });

      expect(res.coordinates()).toEqual([19.4326, -99.1332]);
      expect(res.toString()).toContain(
        '[INSIDE] matches=2 (Zona Norte, Distrito Federal)'
      );
    });

    it('processes point with zero geofence matches', async () => {
      activeServer = await startTestServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              inside: false,
              total_matches: 0,
              matched_geofences: [],
              latitude: 0.0,
              longitude: 0.0,
            },
          })
        );
      });

      const client = new GeoEngine('test-key', {
        apiServiceUrl: activeServer.url,
      });

      const res = await client.spatial.validateGeneral(0.0, 0.0);

      expect(res.isInside()).toBe(false);
      expect(res.hasMatches()).toBe(false);
      expect(res.firstMatch()).toBeNull();
      expect(res.geofenceIds()).toEqual([]);
      expect(res.geofenceNames()).toEqual([]);
    });
  });

  describe('Fluent Query Builder', () => {
    it('executes single geofence checks fluently', async () => {
      activeServer = await startTestServer((req, res) => {
        if (req.url === '/api/spatial/validate') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                inside: true,
                geofence_id: 'geo-builder-1',
                geofence_name: 'Builder Zone',
                latitude: 19.4,
                longitude: -99.1,
              },
            })
          );
        } else if (req.url === '/api/spatial/validate-general') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                inside: true,
                total_matches: 1,
                matched_geofences: [{ id: 'geo-builder-1', name: 'Builder Zone' }],
                latitude: 19.4,
                longitude: -99.1,
              },
            })
          );
        }
      });

      const client = new GeoEngine('test-key', {
        apiServiceUrl: activeServer.url,
      });

      // 1. Single geofence via executeSingle
      const resSingle = await client.spatial
        .check(19.4, -99.1)
        .inGeofence('geo-builder-1')
        .executeSingle();
      expect(resSingle.isInside()).toBe(true);
      expect(resSingle.geofenceName).toBe('Builder Zone');

      // 2. Single geofence via execute & validate aliases
      const resExec = await client.spatial
        .check(19.4, -99.1)
        .inGeofence('geo-builder-1')
        .execute();
      expect(resExec.isInside()).toBe(true);

      const resVal = await client.spatial
        .check(19.4, -99.1)
        .inGeofence('geo-builder-1')
        .validate();
      expect(resVal.isInside()).toBe(true);

      // 3. General geofence via executeGeneral
      const resGeneral = await client.spatial
        .check(19.4, -99.1)
        .inAllGeofences()
        .executeGeneral();
      expect(resGeneral.totalMatches).toBe(1);

      // 4. General geofence via execute
      const resGeneralExec = await client.spatial
        .check(19.4, -99.1)
        .inAllGeofences()
        .execute();
      expect(resGeneralExec.totalMatches).toBe(1);
    });
  });

  describe('Direct Spatial Shortcuts on Client', () => {
    it('delegates shortcuts to spatial service', async () => {
      activeServer = await startTestServer((req, res) => {
        if (req.url === '/api/spatial/validate') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                inside: true,
                geofence_id: 'geo-direct',
                latitude: 10.0,
                longitude: 20.0,
              },
            })
          );
        } else if (req.url === '/api/spatial/validate-general') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                inside: true,
                total_matches: 1,
                matched_geofences: [{ id: 'geo-direct', name: 'Direct' }],
                latitude: 10.0,
                longitude: 20.0,
              },
            })
          );
        }
      });

      const client = new GeoEngine('test-key', {
        apiServiceUrl: activeServer.url,
      });

      const res1 = await client.validateSpatialPoint('geo-direct', 10.0, 20.0);
      expect(res1.isInside()).toBe(true);

      const res2 = await client.validateSpatialLocation({
        geofenceId: 'geo-direct',
        latitude: 10.0,
        longitude: 20.0,
      });
      expect(res2.isInside()).toBe(true);

      const res3 = await client.validateSpatialGeneral(10.0, 20.0);
      expect(res3.isInside()).toBe(true);

      const res4 = await client.validateSpatialGeneralLocation({
        latitude: 10.0,
        longitude: 20.0,
      });
      expect(res4.isInside()).toBe(true);
    });
  });
});
