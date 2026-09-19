import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
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

  describe('validate characterization', () => {
    const destructiveWarning = 'Destructive operations are enabled - use caution in production';
    const schemaWarning = 'Schema changes are enabled - use caution in production';
    const explicitTrustWarning =
      '🚨 SSL certificate trust is explicitly enabled but environment appears to be production - this is a security risk';
    const confidenceWarning =
      '⚠️ SSL certificate trust enabled with low confidence in environment detection - consider setting SQL_SERVER_TRUST_CERT explicitly';
    const productionRecommendation =
      '💡 Production environment detected - consider setting SQL_SERVER_TRUST_CERT=false explicitly for security';
    const connectionError = 'Connection timeout must be greater than 0';
    const requestError = 'Request timeout must be greater than 0';
    const retriesError = 'Max retries must be at least 1';
    const samplingError = 'Performance sampling rate must be between 0 and 1';
    let config;
    let summary;

    beforeEach(() => {
      process.env.SQL_SERVER_TRUST_CERT = 'false';
      config = new ServerConfig();
      Object.assign(config, {
        readOnlyMode: true,
        allowDestructiveOperations: false,
        allowSchemaChanges: false,
        connectionTimeout: 1,
        requestTimeout: 1,
        maxRetries: 1,
        performanceMonitoring: { samplingRate: 0.5 }
      });
      summary = {
        securityDecision: { type: 'explicit', securityLevel: 'high', confidence: 'high' },
        trustCert: false,
        trustCertSource: 'explicit-false',
        isDevEnvironment: false
      };
      config.getConnectionSummary = vi.fn(function () {
        expect(this).toBe(config);
        return summary;
      });
    });

    test.each([
      [true, false, false, []],
      [true, true, false, []],
      [true, false, true, []],
      [true, true, true, []],
      [false, false, false, []],
      [false, true, false, [destructiveWarning]],
      [false, false, true, [schemaWarning]],
      [false, true, true, [destructiveWarning, schemaWarning]]
    ])(
      'operation warnings for readOnly=%s destructive=%s schema=%s',
      (readOnly, destructive, schema, expected) => {
        config.readOnlyMode = readOnly;
        config.allowDestructiveOperations = destructive;
        config.allowSchemaChanges = schema;

        const result = config.validate();

        expect(result.warnings).toEqual(expected);
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
      }
    );

    test.each([
      ['explicit', 'low', false, [explicitTrustWarning]],
      ['explicit', 'low', true, []],
      ['explicit', 'high', false, []],
      ['auto-detected', 'low', false, []]
    ])('explicit trust warning for %s/%s, dev=%s', (type, level, dev, expected) => {
      Object.assign(summary.securityDecision, { type, securityLevel: level });
      summary.isDevEnvironment = dev;
      expect(config.validate().warnings).toEqual(expected);
    });

    test.each([
      ['auto-detected', undefined, []],
      ['auto-detected', [], []],
      [
        'auto-detected',
        ['first', 'second'],
        ['🔍 SSL auto-detection: first', '🔍 SSL auto-detection: second']
      ],
      ['explicit', ['ignored'], []]
    ])('auto-detection warnings for %s with %j', (type, warnings, expected) => {
      Object.assign(summary.securityDecision, { type, warnings });
      expect(config.validate().warnings).toEqual(expected);
    });

    test.each([
      ['low', true, [confidenceWarning]],
      ['low', false, []],
      ['high', true, []],
      ['high', false, []]
    ])('confidence warning for confidence=%s trust=%s', (confidence, trust, expected) => {
      summary.securityDecision.confidence = confidence;
      summary.trustCert = trust;
      expect(config.validate().warnings).toEqual(expected);
    });

    test.each([
      [undefined, false, [productionRecommendation]],
      ['', false, [productionRecommendation]],
      ['false', false, []],
      ['true', false, []],
      [undefined, true, []],
      ['', true, []]
    ])('production recommendation for env=%s dev=%s', (envValue, dev, expected) => {
      if (envValue === undefined) delete process.env.SQL_SERVER_TRUST_CERT;
      else process.env.SQL_SERVER_TRUST_CERT = envValue;
      summary.isDevEnvironment = dev;
      expect(config.validate().warnings).toEqual(expected);
    });

    test.each([
      ['connectionTimeout', -1, connectionError],
      ['connectionTimeout', 0, connectionError],
      ['connectionTimeout', 1, null],
      ['requestTimeout', -1, requestError],
      ['requestTimeout', 0, requestError],
      ['requestTimeout', 1, null],
      ['maxRetries', -1, retriesError],
      ['maxRetries', 0, retriesError],
      ['maxRetries', 1, null],
      ['samplingRate', -Number.EPSILON, samplingError],
      ['samplingRate', 0, null],
      ['samplingRate', 0.5, null],
      ['samplingRate', 1, null],
      ['samplingRate', 1 + Number.EPSILON, samplingError],
      ['samplingRate', Number.NaN, null],
      ['connectionTimeout', Number.NaN, null]
    ])('numeric boundary %s=%s', (field, value, expectedError) => {
      if (field === 'samplingRate') config.performanceMonitoring.samplingRate = value;
      else config[field] = value;

      const result = config.validate();

      expect(result.errors).toEqual(expectedError === null ? [] : [expectedError]);
      expect(result.valid).toBe(expectedError === null);
      expect(result.warnings).toEqual([]);
    });

    test('preserves complete result, warning/error order, and decision identity', () => {
      delete process.env.SQL_SERVER_TRUST_CERT;
      Object.assign(config, {
        readOnlyMode: false,
        allowDestructiveOperations: true,
        allowSchemaChanges: true,
        connectionTimeout: 0,
        requestTimeout: 0,
        maxRetries: 0
      });
      config.performanceMonitoring.samplingRate = 2;
      Object.assign(summary, { trustCert: true, trustCertSource: 'auto-prod' });
      Object.assign(summary.securityDecision, {
        type: 'auto-detected',
        confidence: 'low',
        warnings: ['first', 'second']
      });

      const result = config.validate();

      expect(config.getConnectionSummary).toHaveBeenCalledExactlyOnceWith();
      expect(result).toEqual({
        valid: false,
        warnings: [
          destructiveWarning,
          schemaWarning,
          '🔍 SSL auto-detection: first',
          '🔍 SSL auto-detection: second',
          confidenceWarning,
          productionRecommendation
        ],
        errors: [connectionError, requestError, retriesError, samplingError],
        sslSecurity: {
          decision: summary.securityDecision,
          trustCert: true,
          source: 'auto-prod',
          environment: 'production'
        }
      });
      expect(result.sslSecurity.decision).toBe(summary.securityDecision);
    });

    test.each([true, false])('preserves SSL metadata for dev=%s and returns fresh arrays', dev => {
      summary.isDevEnvironment = dev;
      const first = config.validate();
      first.warnings.push('caller warning');
      first.errors.push('caller error');
      const second = config.validate();

      expect(second).toEqual({
        valid: true,
        warnings: [],
        errors: [],
        sslSecurity: {
          decision: summary.securityDecision,
          trustCert: false,
          source: 'explicit-false',
          environment: dev ? 'development' : 'production'
        }
      });
      expect(second.sslSecurity.decision).toBe(summary.securityDecision);
      expect(config.getConnectionSummary).toHaveBeenCalledTimes(2);
    });

    test('keeps summary lookup, operation reads, decision lookup, and limit reads in order', () => {
      const reads = [];
      config.getConnectionSummary.mockImplementation(function () {
        expect(this).toBe(config);
        reads.push('summary');
        return summary;
      });
      const values = {
        readOnlyMode: false,
        allowDestructiveOperations: true,
        allowSchemaChanges: true,
        connectionTimeout: 1,
        requestTimeout: 1,
        maxRetries: 1,
        performanceMonitoring: { samplingRate: 0.5 }
      };
      for (const [name, value] of Object.entries(values)) {
        Object.defineProperty(config, name, {
          get() {
            reads.push(name);
            return value;
          }
        });
      }
      const decision = summary.securityDecision;
      Object.defineProperty(summary, 'securityDecision', {
        get() {
          reads.push('decision');
          return decision;
        }
      });

      config.validate();

      expect(reads).toEqual([
        'summary',
        'readOnlyMode',
        'allowDestructiveOperations',
        'readOnlyMode',
        'allowSchemaChanges',
        'decision',
        'connectionTimeout',
        'requestTimeout',
        'maxRetries',
        'performanceMonitoring',
        'performanceMonitoring'
      ]);
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
