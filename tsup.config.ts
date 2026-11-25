import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const distDir = fileURLToPath(new URL('./dist', import.meta.url));

/**
 * tsup's CJS code splitting can write absolute local paths into sourcemaps
 * (`file` and `sources`). Rewrite them relative to dist/ so the published package never leaks them.
 */
function sanitizeSourcemaps(): void {
  for (const name of readdirSync(distDir).filter((f) => f.endsWith('.map'))) {
    const file = join(distDir, name);
    const map = JSON.parse(readFileSync(file, 'utf8')) as { file?: string; sources?: string[] };
    if (typeof map.file === 'string' && isAbsolute(map.file)) {
      map.file = basename(map.file);
    }
    if (Array.isArray(map.sources)) {
      map.sources = map.sources.map((src) => (isAbsolute(src) ? relative(distDir, src) : src));
    }
    writeFileSync(file, JSON.stringify(map));
  }
}

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    identity: 'src/identity/index.ts',
  },
  format: ['cjs', 'esm'],
  define: { __SDK_VERSION__: JSON.stringify(pkg.version) },
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: true,
  onSuccess: async () => {
    sanitizeSourcemaps();
  },
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    };
  },
});
