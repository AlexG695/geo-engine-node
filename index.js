const DEFAULTS = {
  managementUrl: 'https://api.geoengine.dev',
  ingestUrl: 'https://ingest.geoengine.dev',
  timeout: 10000
};

class GeoEngine {
  /**
   * Inicializa el cliente de Geo-Engine.
   * @param {string} apiKey - Tu API Key.
   * @param {Object} [options] - Configuración opcional.
   */
  constructor(apiKey, options = {}) {
    if (!apiKey) {
      throw new Error('GeoEngine: API Key es requerida.');
    }

    this.apiKey = apiKey;
    this.config = { ...DEFAULTS, ...options };
    this.userAgent = 'GeoEngineNode/1.1.3';
  }

  /**
   * Helper privado para hacer peticiones con timeout
   */
  async _request(url, method, body) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          'User-Agent': this.userAgent
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(id);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GeoEngine API Error (${response.status}): ${errorText}`);
      }

      if (response.status === 204) return null;

      return await response.json();
    } catch (error) {
      clearTimeout(id);
      if (error.name === 'AbortError') {
        throw new Error(`GeoEngine: La petición excedió el tiempo límite de ${this.config.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Envía una ubicación al motor de ingestión.
   */
  async sendLocation(deviceId, lat, lng) {
    if (!deviceId || lat === undefined || lng === undefined) {
      throw new Error("GeoEngine: deviceId, lat y lng son obligatorios.");
    }

    const payload = {
      device_id: deviceId,
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      timestamp: Math.floor(Date.now() / 1000)
    };

    return this._request(`${this.config.ingestUrl}/ingest`, 'POST', payload);
  }

  /**
   * Crea una nueva geocerca.
   */
  async createGeofence(name, coordinates, webhookUrl) {
    if (!name || !coordinates || coordinates.length < 3) {
      throw new Error("GeoEngine: Se requiere un nombre y al menos 3 coordenadas.");
    }

    // Convertir formato simple [[lat,lng]] a GeoJSON [Lng, Lat]
    const polygon = coordinates.map(p => [p[1], p[0]]);

    // Cerrar polígono automáticamente
    const first = polygon[0];
    const last = polygon[polygon.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      polygon.push(first);
    }

    const payload = {
      name,
      webhook_url: webhookUrl,
      geojson: {
        type: 'Polygon',
        coordinates: [polygon]
      }
    };

    return this._request(`${this.config.managementUrl}/geofences`, 'POST', payload);
  }
}

export default GeoEngine;