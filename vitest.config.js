import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
    exclude: ['test/archived/**'],
    env: {
      NODE_ENV: 'test'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['index.js', 'lib/**/*.js'],
      exclude: ['test/**', 'scripts/**', 'node_modules/**']
    }
  }
});
