import { defineConfig } from 'tsup';

export default defineConfig([
  // Main SDK entry - core functionality
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    external: ['react', 'react-dom'],
    treeshake: true,
    outExtension({ format }) {
      return {
        js: format === 'esm' ? '.mjs' : '.js',
        dts: format === 'esm' ? '.d.mts' : '.d.ts',
      };
    },
  },
  // React entry - hooks and provider
  {
    entry: { react: 'src/react/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    external: ['react', 'react-dom'],
    treeshake: true,
    outExtension({ format }) {
      return {
        js: format === 'esm' ? '.mjs' : '.js',
        dts: format === 'esm' ? '.d.mts' : '.d.ts',
      };
    },
  },
]);
