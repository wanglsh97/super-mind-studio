/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.e2e-spec.ts'],
  setupFiles: ['reflect-metadata', '<rootDir>/e2e.setup.cjs'],
  testTimeout: 20_000,
  moduleNameMapper: {
    '^@supermind/sdk$': '<rootDir>/../../packages/sdk/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  modulePathIgnorePatterns: ['<rootDir>/src/generated/prisma'],
}
