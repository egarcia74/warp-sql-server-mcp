import { describe, test, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

/**
 * Link Checking Tests
 *
 * Following TDD principles, these tests validate:
 * 1. Configuration file exists and is valid
 * 2. NPM scripts are properly defined
 * 3. Configuration settings are comprehensive
 * 4. Integration with build pipeline is correct
 */
describe('Link Checking Functionality', () => {
  describe('Configuration', () => {
    test('should have markdown-link-check configuration file', async () => {
      const configPath = path.join(process.cwd(), '.markdown-link-check.json');

      // Check file exists
      const configExists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false);
      expect(configExists).toBe(true);

      // Check file is valid JSON
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      // Validate essential configuration properties
      expect(config).toHaveProperty('timeout');
      expect(config).toHaveProperty('retryCount');
      expect(config).toHaveProperty('ignorePatterns');
      expect(config.ignorePatterns).toBeInstanceOf(Array);
      expect(config.ignorePatterns.length).toBeGreaterThan(0);
    });

    test('should ignore localhost and development URLs', async () => {
      const configPath = path.join(process.cwd(), '.markdown-link-check.json');
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      const ignoredPatterns = config.ignorePatterns.map(p => p.pattern);
      expect(ignoredPatterns).toContain('^http://localhost');
      expect(ignoredPatterns).toContain('^https://localhost');
      expect(ignoredPatterns).toContain('^mailto:');
    });
  });

  describe('NPM Scripts', () => {
    test('should have links:check script defined', async () => {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageContent);

      expect(packageJson.scripts).toHaveProperty('links:check');
      expect(packageJson.scripts['links:check']).toContain('markdown-link-check');
    });

    test('should have links:check:ci script with config', async () => {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageContent);

      expect(packageJson.scripts).toHaveProperty('links:check:ci');
      expect(packageJson.scripts['links:check:ci']).toContain('--config .markdown-link-check.json');
    });

    test('should have markdown-link-check as dev dependency', async () => {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageContent);

      expect(packageJson.devDependencies).toHaveProperty('markdown-link-check');
    });
  });

  describe('Configuration Validation', () => {
    test('should handle configuration correctly', async () => {
      const configPath = path.join(process.cwd(), '.markdown-link-check.json');
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      // Test configuration completeness
      expect(config.timeout).toBeDefined();
      expect(config.retryCount).toBeGreaterThan(0);
      expect(config.retryOn429).toBe(true);
      expect(config.aliveStatusCodes).toContain(200);

      // Test ignore patterns are comprehensive
      const patterns = config.ignorePatterns.map(p => p.pattern);
      expect(patterns.some(p => p.includes('localhost'))).toBe(true);
    });
  });
});
