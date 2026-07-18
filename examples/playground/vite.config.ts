import devServer from '@hono/vite-dev-server';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // Serves src/api (login + Zero query/mutate endpoints) from the same
    // origin as the app; unmatched routes fall through to Vite.
    devServer({ entry: 'src/api/index.ts' }),
  ],
});
