import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { ServerConfig } from '../../lib/config/server-config.js';

describe('ServerConfig', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('development environment detection', () => {
    test('should detect localhost as development environment', () => {
      process.env.SQL_SERVER_HOST = 'localhost';
      const config = new ServerConfig();
      const summary = config.getConnectionSummary();
      expect(summary.isDevEnvironment).toBe(true);
    });

    test('should detect 127.0.0.1 as development environment', () => {
      process.env.SQL_SERVER_HOST = '127.0.0.1';
      const config = new ServerConfig();
      const summary = config.getConnectionSummary();
      expect(summary.isDevEnvironment).toBe(true);
    });

    test('should detect .local domains as development environment', () => {
      process.env.SQL_SERVER_HOST = 'mydb.local';
      const config = new ServerConfig();
      const summary = config.getConnectionSummary();
      expect(summary.isDevEnvironment).toBe(true);
    });

    test('should detect private IP ranges as development environment', () => {
      const privateIPs = ['192.168.1.100', '10.0.0.1', '172.16.0.1'];

      privateIPs.forEach(ip => {
        process.env.SQL_SERVER_HOST = ip;
        const config = new ServerConfig();
        const summary = config.getConnectionSummary();
        expect(summary.isDevEnvironment).toBe(true);
      });
    });

    test('should not detect production hosts as development environment', () => {
      process.env.SQL_SERVER_HOST = 'prod-db.company.com';
      process.env.NODE_ENV = 'production';
      const config = new ServerConfig();
      const summary = config.getConnectionSummary();
      expect(summary.isDevEnvironment).toBe(false);
    });

    test('should detect NODE_ENV=development', () => {
      process.env.NODE_ENV = 'development';
      process.env.SQL_SERVER_HOST = 'prod-db.company.com';
      const config = new ServerConfig();
      const summary = config.getConnectionSummary();
      expect(summary.isDevEnvironment).toBe(true);
    });

    test('should detect NODE_ENV=test', () => {
      process.env.NODE_ENV = 'test';
      process.env.SQL_SERVER_HOST = 'prod-db.company.com';
      const config = new ServerConfig();
      const summary = config.getConnectionSummary();
      expect(summary.isDevEnvironment).toBe(true);
    });
  });

  describe('SSL certificate trust configuration', () => {
    test('should use explicit true when SQL_SERVER_TRUST_CERT=true', () => {
      process.env.SQL_SERVER_TRUST_CERT = 'true';
      process.env.SQL_SERVER_HOST = 'prod-db.company.com';
      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      expect(summary.trustCert).toBe(true);
      expect(summary.trustCertSource).toBe('explicit-true');
    });

    test('should use explicit false when SQL_SERVER_TRUST_CERT=false', () => {
      process.env.SQL_SERVER_TRUST_CERT = 'false';
      process.env.SQL_SERVER_HOST = 'localhost';
      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      expect(summary.trustCert).toBe(false);
      expect(summary.trustCertSource).toBe('explicit-false');
    });

    test('should auto-detect true for development environments', () => {
      delete process.env.SQL_SERVER_TRUST_CERT;
      process.env.SQL_SERVER_HOST = 'localhost';
      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      expect(summary.trustCert).toBe(true);
      expect(summary.trustCertSource).toBe('auto-dev');
    });

    test('should auto-detect false for production environments', () => {
      delete process.env.SQL_SERVER_TRUST_CERT;
      process.env.SQL_SERVER_HOST = 'prod-db.company.com';
      process.env.NODE_ENV = 'production';
      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      expect(summary.trustCert).toBe(false);
      expect(summary.trustCertSource).toBe('auto-prod');
    });
  });

  describe('connection summary display', () => {
    test('should include SSL certificate trust source information', () => {
      process.env.SQL_SERVER_HOST = 'localhost';
      process.env.SQL_SERVER_DATABASE = 'testdb';
      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      expect(summary.trustCertSource).toBeDefined();
      expect(summary.isDevEnvironment).toBeDefined();
      expect(['explicit-true', 'explicit-false', 'auto-dev', 'auto-prod']).toContain(
        summary.trustCertSource
      );
    });

    test('should include password redaction in summary', () => {
      process.env.SQL_SERVER_USER = 'testuser';
      process.env.SQL_SERVER_PASSWORD = 'secretpassword123';
      process.env.SQL_SERVER_HOST = 'localhost';
      process.env.SQL_SERVER_DATABASE = 'testdb';

      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      // Username is shown in cleartext for config verification
      expect(summary.user).toBe('testuser');
      // Password is fully redacted for security
      expect(summary.password).toBe('***********');
      expect(summary.password).not.toBe('secretpassword123');
    });
  });
});
