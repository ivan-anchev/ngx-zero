import devServer from '@hono/vite-dev-server';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // Everything outside /api/ stays with Vite.
    devServer({ entry: 'src/api/index.ts', exclude: [/^(?!\/api\/)/] }),
  ],
});
