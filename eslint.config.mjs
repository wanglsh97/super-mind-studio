import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      'apps/api/src/generated/prisma/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      // NestJS constructor injection relies on runtime decorator metadata. Imports that
      // appear type-only to ESLint may still be required as runtime values.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['apps/web/src/app/chat/**/*.{ts,tsx}', 'apps/web/src/components/chat/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Chat 页面必须通过 @supermind/sdk 发起请求。',
        },
        {
          name: 'EventSource',
          message: 'Chat 页面必须使用 @supermind/sdk 提供的 POST SSE 能力。',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/api/src/**', '**/providers/**', '**/adapters/**'],
              message: 'Web Chat 不得引用服务端 Adapter 或 provider 类型。',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='getReader']",
          message: 'Chat 页面不得自行解析 ReadableStream，请使用 @supermind/sdk。',
        },
        {
          selector: "NewExpression[callee.name='TextDecoder']",
          message: 'Chat 页面不得自行实现 SSE 文本解析，请使用 @supermind/sdk。',
        },
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: globals.commonjs,
    },
  },
)
