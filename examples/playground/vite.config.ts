import angular from '@analogjs/vite-plugin-angular';
import devServer from '@hono/vite-dev-server';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    mainFields: ['module'],
  },
  plugins: [
    angular({ tsconfig: './tsconfig.app.json' }),
    // Everything outside /api/ stays with Vite.
    devServer({ entry: 'src/api/index.ts', exclude: [/^(?!\/api\/)/] }),
  ],
});
