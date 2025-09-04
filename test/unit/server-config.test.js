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
      expect(summary.securityDecision).toBeDefined();
      expect(summary.environmentAnalysis).toBeDefined();
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

  describe('enhanced SSL security logic', () => {
    test('should provide detailed security decision for explicit trust=true', () => {
      process.env.SQL_SERVER_TRUST_CERT = 'true';
      process.env.SQL_SERVER_HOST = 'prod-db.company.com';
      process.env.NODE_ENV = 'production';

      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      expect(summary.securityDecision.type).toBe('explicit');
      expect(summary.securityDecision.securityLevel).toBe('low');
      expect(summary.securityDecision.reason).toContain('explicitly enabled');
      expect(summary.securityDecision.recommendation).toContain('development');
    });

    test('should provide detailed security decision for explicit trust=false', () => {
      process.env.SQL_SERVER_TRUST_CERT = 'false';
      process.env.SQL_SERVER_HOST = 'localhost';
      process.env.NODE_ENV = 'development';

      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      expect(summary.securityDecision.type).toBe('explicit');
      expect(summary.securityDecision.securityLevel).toBe('high');
      expect(summary.securityDecision.reason).toContain('explicitly disabled');
      expect(summary.securityDecision.recommendation).toContain('production');
    });

    test('should provide detailed security decision for auto-detection development', () => {
      delete process.env.SQL_SERVER_TRUST_CERT;
      process.env.SQL_SERVER_HOST = 'localhost';
      process.env.NODE_ENV = 'development';

      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      expect(summary.securityDecision.type).toBe('auto-detected');
      expect(summary.securityDecision.securityLevel).toBe('low');
      expect(summary.securityDecision.confidence).toBe('high');
      expect(summary.securityDecision.reason).toContain('Development environment detected');
    });

    test('should provide detailed security decision for auto-detection production', () => {
      delete process.env.SQL_SERVER_TRUST_CERT;
      process.env.SQL_SERVER_HOST = 'prod-db.company.com';
      process.env.NODE_ENV = 'production';

      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      expect(summary.securityDecision.type).toBe('auto-detected');
      expect(summary.securityDecision.securityLevel).toBe('high');
      expect(summary.securityDecision.confidence).toBe('low');
      expect(summary.securityDecision.reason).toContain('Production environment assumed');
    });

    test('should warn about private IP without explicit dev environment', () => {
      delete process.env.SQL_SERVER_TRUST_CERT;
      delete process.env.NODE_ENV;
      process.env.SQL_SERVER_HOST = '192.168.1.100';

      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      expect(summary.environmentAnalysis.prodWarnings).toContain(
        'private IP (192.168.1.100) without explicit NODE_ENV=development (could be cloud production)'
      );
    });

    test('should warn about .local domain without explicit dev environment', () => {
      delete process.env.SQL_SERVER_TRUST_CERT;
      delete process.env.NODE_ENV;
      process.env.SQL_SERVER_HOST = 'mydb.local';

      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      expect(summary.environmentAnalysis.prodWarnings).toContain(
        '.local domain without explicit NODE_ENV=development (could be production)'
      );
    });

    test('should be conservative with private IP + dev environment', () => {
      delete process.env.SQL_SERVER_TRUST_CERT;
      process.env.NODE_ENV = 'development';
      process.env.SQL_SERVER_HOST = '192.168.1.100';

      const config = new ServerConfig();
      const summary = config.getConnectionSummary();

      expect(summary.trustCert).toBe(true);
      // Should have both NODE_ENV indicator and private IP with explicit dev environment
      expect(summary.environmentAnalysis.devIndicators).toContain('NODE_ENV=development');
      expect(summary.environmentAnalysis.devIndicators).toContain(
        'private IP (192.168.1.100) with explicit dev environment'
      );
    });
  });

  describe('configuration validation with SSL security', () => {
    test('should warn about explicit trust in production environment', () => {
      process.env.SQL_SERVER_TRUST_CERT = 'true';
      process.env.SQL_SERVER_HOST = 'prod-db.company.com';
      process.env.NODE_ENV = 'production';

      const config = new ServerConfig();
      const validation = config.validate();

      const sslWarning = validation.warnings.find(
        w =>
          w.includes('SSL certificate trust is explicitly enabled') && w.includes('security risk')
      );
      expect(sslWarning).toBeDefined();
    });

    test('should warn about low confidence SSL auto-detection', () => {
      delete process.env.SQL_SERVER_TRUST_CERT;
      delete process.env.NODE_ENV;
      process.env.SQL_SERVER_HOST = '192.168.1.100';

      const config = new ServerConfig();
      const validation = config.validate();

      expect(
        validation.warnings.some(
          w => w.includes('SSL auto-detection') || w.includes('low confidence')
        )
      ).toBe(true);
    });

    test('should recommend explicit SSL configuration for production', () => {
      delete process.env.SQL_SERVER_TRUST_CERT;
      process.env.SQL_SERVER_HOST = 'prod-db.company.com';
      process.env.NODE_ENV = 'production';

      const config = new ServerConfig();
      const validation = config.validate();

      const recommendation = validation.warnings.find(
        w =>
          w.includes('Production environment detected') &&
          w.includes('SQL_SERVER_TRUST_CERT=false explicitly')
      );
      expect(recommendation).toBeDefined();
    });

    test('should include SSL security information in validation result', () => {
      const config = new ServerConfig();
      const validation = config.validate();

      expect(validation.sslSecurity).toBeDefined();
      expect(validation.sslSecurity.decision).toBeDefined();
      expect(validation.sslSecurity.trustCert).toBeDefined();
      expect(validation.sslSecurity.source).toBeDefined();
      expect(['development', 'production']).toContain(validation.sslSecurity.environment);
    });
  });
});
