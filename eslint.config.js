// @ts-check
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.vite/**', '**/coverage/**'],
  },

  // TypeScript with type-checking for all packages
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: [
          './packages/types/tsconfig.json',
          './packages/backend/tsconfig.json',
          './packages/frontend/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...tsPlugin.configs['recommended-type-checked'].rules,
    },
  },

  // React hooks rules — frontend only
  {
    files: ['packages/frontend/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Prettier last — disables all formatting rules that conflict with Prettier
  prettier,
];
