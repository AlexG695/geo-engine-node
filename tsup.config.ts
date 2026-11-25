import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

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
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    };
  },
});
