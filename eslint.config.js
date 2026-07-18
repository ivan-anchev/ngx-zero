import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'examples/*/dist/'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      curly: ['error', 'all'],
    },
  },
);
