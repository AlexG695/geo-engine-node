import { createHmac } from 'node:crypto';

/**
 * Generates an HMAC-SHA256 signature from the API key and timestamp (in milliseconds).
 * Matches the Go SDK Client.generateHMACSignature implementation.
 *
 * @param key The API secret key used as the HMAC secret
 * @param timestamp Epoch timestamp in milliseconds
 * @returns 64-character lowercase hexadecimal hash
 */
export function generateHMACSignature(key: string, timestamp: number): string {
  if (!key) {
    return '';
  }
  return createHmac('sha256', key)
    .update(timestamp.toString())
    .digest('hex');
}
