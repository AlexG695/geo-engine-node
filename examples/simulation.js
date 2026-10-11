import GeoEngine, { GeofenceNotFoundError } from '../dist/index.js';

async function main() {
  console.log('🚀 Iniciando simulación de GeoEngine SDK (Node.js/TS v2.0.0)...\n');

  // Inicializar cliente
  const client = new GeoEngine('sk_test_demo_key', {
    environment: 'test',
    baseUrl: 'https://api.geoengine.dev', // o http://localhost:8080 para entorno local
    timeout: 5000,
  });

  console.log('1. Opciones configuradas:');
  console.log('   - Environment:', client.options.environment);
  console.log('   - Timeout:', client.options.timeout, 'ms');
  console.log('   - Ingest URL:', client.options.ingestUrl);
  console.log('   - Spatial API URL:', client.options.apiServiceUrl);

  console.log('\n2. Creando geocerca de prueba...');
  const polygon = [
    [19.4326, -99.1332],
    [19.4426, -99.1332],
    [19.4426, -99.1232],
  ];

  try {
    await client.createGeofence(
      'Zona Demo CDMX',
      polygon,
      'https://ejemplo.com/webhook'
    );
    console.log('   ✅ Geocerca creada con éxito');
  } catch (err) {
    console.log('   ℹ️ Petición a geocerca (modo simulación):', err.message);
  }

  console.log('\n3. Validando coordenadas espaciales con Fluent Builder...');
  try {
    const check = await client.spatial
      .check(19.4326, -99.1332)
      .inGeofence('geo_demo_01')
      .execute();

    console.log('   Resultado:', check.toString());
  } catch (err) {
    if (err instanceof GeofenceNotFoundError) {
      console.log('   ℹ️ Geocerca no encontrada (204/404 manejado correctamente)');
    } else {
      console.log('   ℹ️ Error espacial simulado:', err.message);
    }
  }

  console.log('\n4. Probando AsyncIngester (batch de telemetría)...');
  const ingester = client.createAsyncIngester(100, 5, 200);

  const enqueued = ingester.enqueue({
    deviceId: 'camion-01',
    latitude: 19.4326,
    longitude: -99.1332,
    timestamp: Date.now(),
  });
  console.log('   Ping encolado con éxito:', enqueued);

  await ingester.stop();
  console.log('   ✅ AsyncIngester drenado y detenido limpiamente');

  client.close();
  console.log('\n✨ Simulación finalizada con éxito.');
}

main().catch(console.error);
