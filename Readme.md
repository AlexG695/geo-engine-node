# 📦 Geo-Engine Node.js SDK

![NPM Version](https://img.shields.io/npm/v/geo-engine-node?style=flat-square&color=blue)
![License](https://img.shields.io/npm/l/geo-engine-node?style=flat-square)
![Types](https://img.shields.io/npm/types/geo-engine-node?style=flat-square)
![Size](https://img.shields.io/bundlephobia/minzip/geo-engine-node?style=flat-square)

Cliente oficial de alto rendimiento para interactuar con la plataforma **Geo-Engine**.  
Procesa ubicaciones en tiempo real, detecta cruces de geocercas y dispara webhooks en milisegundos.

---

## ✨ Características

- 🚀 **Rendimiento:** Diseñado para manejar alta ingestión de datos.
- 🛡️ **Type-Safe:** Incluye definiciones TypeScript (`.d.ts`) nativas.
- 📦 **Híbrido:** Funciona con `require` (CommonJS) y `import` (ES Modules).
- ⚡ **Ligero:** Cero dependencias pesadas.

---

## 🚀 Instalación

```bash
npm install geo-engine-node
````

---

## ⚡ Inicio Rápido

Geo-Engine soporta tanto sintaxis moderna como clásica.

### Opción A: ES Modules (Recomendado)

```js
import GeoEngine from 'geo-engine-node';

// Inicializa con tu API Key
const geo = new GeoEngine('sk_test_12345abcdef');

// Envía una coordenada (ID, Latitud, Longitud)
try {
  const res = await geo.sendLocation('camion-01', 19.4326, -99.1332);
  console.log('✅ Ubicación procesada:', res);
} catch (err) {
  console.error('❌ Error:', err.message);
}
```

### Opción B: CommonJS (Legacy)

```js
const GeoEngine = require('geo-engine-node');

const geo = new GeoEngine('sk_test_...');
```

---

## 📚 Referencia de la API

### `new GeoEngine(apiKey, [options])`

Crea una nueva instancia del cliente.

**Parámetros:**

* `apiKey` (`string`): Tu clave secreta de API.
* `options` (`object`, opcional):

  * `timeout`: Tiempo de espera en ms (default: `10000`)
  * `ingestUrl`: URL personalizada (útil para proxies o testing)
  * `managementUrl`: URL del servicio de administración

---

### `geo.sendLocation(deviceId, lat, lng)`

Envía un punto de rastreo al motor de ingestión.
El sistema evaluará automáticamente las reglas espaciales.

**Parámetros:**

* `deviceId` (`string`): ID único (placa, UUID, etc).
* `lat` (`number`): Latitud decimal (Ej: `19.43`)
* `lng` (`number`): Longitud decimal (Ej: `-99.13`)

---

### `geo.createGeofence(name, coordinates, webhookUrl)`

Crea dinámicamente una zona de monitoreo.
Geo-Engine enviará un `POST` a tu webhook cuando un activo entre o salga.

**Ejemplo:**

```js
// Definir polígono: Array de [Lat, Lng]
const zona = [
  [19.42, -99.16],
  [19.41, -99.16],
  [19.41, -99.15],
  [19.42, -99.15]
];

await geo.createGeofence(
  'Almacén Central',
  zona,
  'https://mi-api.com/webhooks/geofence-alert'
);
```

---

## 🧪 Desarrollo Local

Ideal para probar con tu propia instancia de Geo-Engine corriendo en Docker o Localhost.

```js
const geo = new GeoEngine('local-key', {
  ingestUrl: 'http://localhost:8080',
  managementUrl: 'http://localhost:8081'
});
```

---

## 📄 Licencia

MIT © Geo-Engine Team

