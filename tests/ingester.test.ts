import { describe, expect, it, vi } from 'vitest';
import { AsyncIngester, GeoEngine } from '../src/index.js';

describe('AsyncIngester (Table-Driven)', () => {
  it('handles enqueue and stop lifecycle correctly', async () => {
    const mockSendLocation = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      sendLocation: mockSendLocation,
    };

    const ingester = new AsyncIngester(mockClient, 50, 5, 50);

    // Enqueue null or undefined returns false
    expect(ingester.enqueue(null)).toBe(false);
    expect(ingester.enqueue(undefined)).toBe(false);

    // Enqueue valid ping returns true
    const validPing = {
      deviceId: 'dev-01',
      latitude: 19.4326,
      longitude: -99.1332,
      timestamp: Date.now(),
    };
    expect(ingester.enqueue(validPing)).toBe(true);

    // Stop drains all items
    await ingester.stop();
    expect(mockSendLocation).toHaveBeenCalledWith('dev-01', 19.4326, -99.1332);

    // Subsequent enqueue after Stop returns false
    expect(ingester.enqueue(validPing)).toBe(false);

    // Multiple stop() calls should be idempotent and safe
    await ingester.stop();
  });

  it('automatically flushes when batch size limit is reached', async () => {
    const mockSendLocation = vi.fn().mockResolvedValue(undefined);
    const mockClient = { sendLocation: mockSendLocation };

    // Batch size of 3, large interval of 10 seconds
    const ingester = new AsyncIngester(mockClient, 100, 3, 10000);

    ingester.enqueue({ deviceId: 'dev-1', latitude: 10, longitude: 20 });
    ingester.enqueue({ deviceId: 'dev-2', latitude: 11, longitude: 21 });
    expect(mockSendLocation).not.toHaveBeenCalled();

    // 3rd ping triggers flush
    ingester.enqueue({ deviceId: 'dev-3', latitude: 12, longitude: 22 });

    // Allow microtasks to complete
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(mockSendLocation).toHaveBeenCalledTimes(3);

    await ingester.stop();
  });

  it('rejects enqueue when buffer size capacity is full', async () => {
    const mockSendLocation = vi.fn().mockResolvedValue(undefined);
    const mockClient = { sendLocation: mockSendLocation };

    // Buffer capacity 2, batchSize 10, flushInterval 10000
    const ingester = new AsyncIngester(mockClient, 2, 10, 10000);

    expect(ingester.enqueue({ deviceId: 'd1', latitude: 1, longitude: 1 })).toBe(true);
    expect(ingester.enqueue({ deviceId: 'd2', latitude: 2, longitude: 2 })).toBe(true);
    // Buffer capacity is full:
    expect(ingester.enqueue({ deviceId: 'd3', latitude: 3, longitude: 3 })).toBe(false);

    await ingester.stop();
  });

  it('creates AsyncIngester via client.createAsyncIngester', async () => {
    const client = new GeoEngine('sk_test', {
      bufferSize: 100,
      batchSize: 10,
      flushInterval: 200,
    });

    const ingester = client.createAsyncIngester();
    expect(ingester).toBeInstanceOf(AsyncIngester);

    await ingester.stop();
    client.close();
  });
});
