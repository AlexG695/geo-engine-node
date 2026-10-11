import type { LocationPing } from './models.js';
import { clearInterval, setInterval } from 'node:timers';

export interface IngesterClient {
  sendLocation(
    deviceId: string,
    lat: number,
    lng: number
  ): Promise<void | unknown>;
}

/**
 * Manages an in-memory queue for background batch ingestion of location telemetry.
 * Equivalent to Go's AsyncIngester.
 */
export class AsyncIngester {
  private readonly client: IngesterClient;
  private readonly bufferSize: number;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly queue: LocationPing[] = [];
  private readonly inFlightPromises: Set<Promise<unknown>> = new Set();
  private timer: ReturnType<typeof setInterval> | null = null;
  private isClosed = false;

  constructor(
    client: IngesterClient,
    bufferSize = 5000,
    batchSize = 100,
    flushIntervalMs = 500
  ) {
    this.client = client;
    this.bufferSize = bufferSize;
    this.batchSize = batchSize;
    this.intervalMs = flushIntervalMs;

    this.timer = setInterval(() => {
      void this.flush();
    }, this.intervalMs);

    // Unref timer so it doesn't block Node process termination if left running
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Non-blockingly appends a location ping to the ingestion buffer queue.
   *
   * @param ping Location ping object
   * @returns true if successfully queued, false if queue is full or ingester is stopped
   */
  enqueue(ping: LocationPing | null | undefined): boolean {
    if (!ping || this.isClosed) {
      return false;
    }

    if (this.queue.length >= this.bufferSize) {
      return false; // Queue buffer capacity full
    }

    this.queue.push(ping);

    if (this.queue.length >= this.batchSize) {
      void this.flush();
    }

    return true;
  }

  /**
   * Flushes current queued batch of location telemetry items.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0, this.batchSize);
    if (batch.length === 0) {
      return;
    }

    const flushPromise = Promise.all(
      batch.map(item =>
        this.client.sendLocation(item.deviceId, item.latitude, item.longitude).catch(() => {
          // Swallow individual background flush errors to avoid unhandled rejections
        })
      )
    ).finally(() => {
      this.inFlightPromises.delete(flushPromise);
    });

    this.inFlightPromises.add(flushPromise);
    await flushPromise;
  }

  /**
   * Drains all remaining pending items, halts worker timer, and releases resources.
   * Safe to call multiple times.
   */
  async stop(): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Flush any remaining items in queue
    while (this.queue.length > 0) {
      await this.flush();
    }

    // Await all in-flight promises
    if (this.inFlightPromises.size > 0) {
      await Promise.all(Array.from(this.inFlightPromises));
    }
  }
}
