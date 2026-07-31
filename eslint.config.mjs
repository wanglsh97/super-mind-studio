import js from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import globals from 'globals'
import importX from 'eslint-plugin-import-x'
import jest from 'eslint-plugin-jest'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

const typescriptFiles = ['**/*.{ts,tsx}']
const javascriptFiles = ['**/*.{js,mjs,cjs,jsx}']
const webSourceFiles = ['apps/web/src/**/*.{ts,tsx}']
const webComponentFiles = ['apps/web/src/**/*.{tsx,jsx}']
const apiJestFiles = ['apps/api/**/*.spec.ts', 'apps/api/**/*.e2e-spec.ts']
const warningRules = (rules) =>
  Object.fromEntries(
    Object.entries(rules).map(([name, value]) => [
      name,
      Array.isArray(value) ? ['warn', ...value.slice(1)] : 'warn',
    ]),
  )

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/generated/**',
      'apps/api/src/generated/prisma/**',
      '.agents/**',
      '.codex/**',
      'artifacts/**',
      'openspec/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: typescriptFiles,
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
      '@typescript-eslint/no-import-type-side-effects': 'error',
      'import-x/consistent-type-specifier-style': ['warn', 'prefer-top-level'],
      'import-x/no-duplicates': 'error',
      'import-x/order': [
        'warn',
        {
          alphabetize: { caseInsensitive: true, order: 'asc' },
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          'newlines-between': 'always',
          pathGroupsExcludedImportTypes: ['builtin'],
        },
      ],
    },
  },
  {
    files: javascriptFiles,
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    files: typescriptFiles,
    plugins: {
      'import-x': importX,
    },
  },
  {
    files: webSourceFiles,
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    files: webComponentFiles,
    ...jsxA11y.flatConfigs.recommended,
    plugins: {
      ...jsxA11y.flatConfigs.recommended.plugins,
      'react-hooks': reactHooks,
    },
    rules: {
      ...warningRules(jsxA11y.flatConfigs.recommended.rules),
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    ...jest.configs['flat/recommended'],
    files: apiJestFiles,
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
