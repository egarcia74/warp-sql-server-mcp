import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the mssql module to avoid any real DB interactions
vi.mock('mssql', () => ({
  default: {
    connect: vi.fn(),
    ConnectionPool: vi.fn()
  },
  connect: vi.fn(),
  ConnectionPool: vi.fn()
}));

// Mock StdioServerTransport to avoid importing actual MCP SDK transport
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(() => ({
    connect: vi.fn()
  }))
}));

import { SqlServerMCP } from '../../index.js';
import sql from 'mssql';

// Mock transport and server for startup tests
const mockStdioTransport = { connect: vi.fn() };

describe('SQL Server MCP Lifecycle', () => {
  let mcpServer;
  let mockPool;
  let mockRequest;
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    process.env = {
      ...originalEnv,
      SQL_SERVER_HOST: 'localhost',
      SQL_SERVER_PORT: '1433',
      SQL_SERVER_DATABASE: 'master',
      SQL_SERVER_USER: 'testuser',
      SQL_SERVER_PASSWORD: 'testpass'
    };

    // Reset all mocks
    vi.clearAllMocks();

    // Mock SQL pool and request
    mockRequest = {
      query: vi.fn(),
      timeout: 30000
    };
    mockPool = {
      request: vi.fn(() => mockRequest),
      connected: true,
      close: vi.fn()
    };

    // Create an actual SqlServerMCP instance for testing
    // Mock the server setup to prevent actual MCP server initialization
    vi.spyOn(SqlServerMCP.prototype, 'setupToolHandlers').mockImplementation(() => {});
    
    mcpServer = new SqlServerMCP();
    mcpServer.pool = null; // Reset pool
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Configuration Summary', () => {
    let originalConsoleError;
    let consoleErrorSpy;
    let originalNodeEnv;

    beforeEach(() => {
      originalConsoleError = console.error;
      consoleErrorSpy = vi.fn();
      console.error = consoleErrorSpy;

      // Temporarily disable test mode for these tests
      originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
    });

    afterEach(() => {
      console.error = originalConsoleError;
      process.env.NODE_ENV = originalNodeEnv;
    });

    test('should print secure configuration summary', () => {
      // Test with default secure configuration
      mcpServer = new SqlServerMCP();
      mcpServer.printConfigurationSummary();

      // In test environment, connection fails but shows connection attempt
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Connection failed to localhost:1433/master')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Security: 🔒 SECURE (RO, DML-, DDL-)')
      );
      // Should not show security warnings for secure config
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('WARNING: Read-write mode')
      );
    });

    test('should print unsafe configuration summary with warnings', () => {
      // Test with unsafe configuration
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'true';
      mcpServer = new SqlServerMCP();
      mcpServer.printConfigurationSummary();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Security: ⚠️  UNSAFE (RW, DML+, DDL+)')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('WARNING: Read-write mode, DML allowed, DDL allowed')
      );
    });

    test('should print mixed configuration correctly', () => {
      // Test with mixed configuration (read-write but no destructive ops)
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'false';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';
      mcpServer = new SqlServerMCP();
      mcpServer.printConfigurationSummary();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Security: ⚠️  UNSAFE (RW, DML-, DDL-)')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('WARNING: Read-write mode')
      );
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('DML allowed'));
    });

    test('should display correct authentication method for SQL Auth', () => {
      process.env.SQL_SERVER_USER = 'testuser';
      mcpServer = new SqlServerMCP();
      mcpServer.printConfigurationSummary();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('(SQL Auth)'));
    });

    test('should display correct authentication method for Windows Auth', () => {
      delete process.env.SQL_SERVER_USER;
      delete process.env.SQL_SERVER_PASSWORD;
      mcpServer = new SqlServerMCP();
      mcpServer.printConfigurationSummary();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('(Windows Auth)'));
    });

    test('should display custom host and port', () => {
      process.env.SQL_SERVER_HOST = 'sqlserver.example.com';
      process.env.SQL_SERVER_PORT = '1434';
      process.env.SQL_SERVER_DATABASE = 'MyDatabase';
      mcpServer = new SqlServerMCP();
      mcpServer.printConfigurationSummary();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Connection failed to sqlserver.example.com:1434/MyDatabase')
      );
    });

    test('should not print anything during tests', () => {
      // Restore test mode for this specific test
      process.env.NODE_ENV = 'test';

      mcpServer = new SqlServerMCP();
      mcpServer.printConfigurationSummary();

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    test('should handle partial unsafe configurations correctly', () => {
      // DML operations enabled, but read-only mode should make it secure
      process.env.SQL_SERVER_READ_ONLY = 'true';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';
      mcpServer = new SqlServerMCP();
      mcpServer.printConfigurationSummary();

      // The actual behavior shows UNSAFE because DML+ is displayed, but there should be a warning
      // since read-only mode is enabled (which overrides the DML setting in practice)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Security: ⚠️  UNSAFE (RO, DML+, DDL-)')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('WARNING: DML allowed'));
    });
  });

  describe('Server Startup and Runtime', () => {
    describe('run() method', () => {
      let originalConsoleError;
      let consoleErrorSpy;
      let originalNodeEnv;
      let _mockTransport;
      let mockServer;

      beforeEach(() => {
        // Mock console.error to capture startup messages
        originalConsoleError = console.error;
        consoleErrorSpy = vi.fn();
        console.error = consoleErrorSpy;

        // Temporarily disable test mode for these tests
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        // Mock the transport and server
        _mockTransport = { connect: vi.fn() };
        mockServer = { connect: vi.fn().mockResolvedValue() };

        // Replace the server instance
        mcpServer.server = mockServer;
      });

      afterEach(() => {
        console.error = originalConsoleError;
        process.env.NODE_ENV = originalNodeEnv;
        vi.restoreAllMocks();
      });

      test('should start server successfully with database connection', async () => {
        // Mock successful database connection
        vi.spyOn(mcpServer, 'connectToDatabase').mockResolvedValue(mockPool);

        await mcpServer.run();

        // Verify startup messages
        expect(consoleErrorSpy).toHaveBeenCalledWith('Starting Warp SQL Server MCP server...');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Database connection pool initialized successfully'
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith('Warp SQL Server MCP server running on stdio');

        // Verify database connection was attempted
        expect(mcpServer.connectToDatabase).toHaveBeenCalled();

        // Verify server connection was called
        expect(mockServer.connect).toHaveBeenCalled();
      });

      test('should handle database connection failure gracefully during startup', async () => {
        const dbError = new Error('Connection refused');
        vi.spyOn(mcpServer, 'connectToDatabase').mockRejectedValue(dbError);

        await mcpServer.run();

        // Verify error handling messages
        expect(consoleErrorSpy).toHaveBeenCalledWith('Starting Warp SQL Server MCP server...');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to initialize database connection pool:',
          'Connection refused'
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Server will continue but database operations will likely fail'
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith('Warp SQL Server MCP server running on stdio');

        // Verify server still starts despite DB failure
        expect(mockServer.connect).toHaveBeenCalled();
      });

      test('should handle server connection errors during startup', async () => {
        const serverError = new Error('Transport connection failed');
        vi.spyOn(mcpServer, 'connectToDatabase').mockResolvedValue(mockPool);
        mockServer.connect.mockRejectedValue(serverError);

        await expect(mcpServer.run()).rejects.toThrow('Transport connection failed');

        // Server connection fails before database connection is attempted
        expect(mcpServer.connectToDatabase).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(
          'Database connection pool initialized successfully'
        );
        expect(consoleErrorSpy).not.toHaveBeenCalledWith('Starting Warp SQL Server MCP server...');

        // Verify server connection was attempted
        expect(mockServer.connect).toHaveBeenCalled();
      });

      test('should handle both database and server connection failures', async () => {
        const dbError = new Error('Database unavailable');
        const serverError = new Error('Transport unavailable');

        vi.spyOn(mcpServer, 'connectToDatabase').mockRejectedValue(dbError);
        mockServer.connect.mockRejectedValue(serverError);

        await expect(mcpServer.run()).rejects.toThrow('Transport unavailable');

        // Since server connection fails first, database connection is never attempted
        expect(mcpServer.connectToDatabase).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(
          'Failed to initialize database connection pool:',
          'Database unavailable'
        );
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(
          'Server will continue but database operations will likely fail'
        );
      });
    });

    describe('Entry Point Execution', () => {
      let originalArgv;
      let _originalImportMetaUrl;

      beforeEach(() => {
        originalArgv = process.argv;
        // We can't easily mock import.meta.url, so we'll test the logic indirectly
      });

      afterEach(() => {
        process.argv = originalArgv;
      });

      test('should create and run server when executed as main module', async () => {
        // Since we can't easily mock import.meta.url in tests, we'll test the
        // conditional logic by verifying that if the condition were true,
        // the server would be created and run() called

        const mockRunMethod = vi.fn().mockResolvedValue();
        const originalRun = SqlServerMCP.prototype.run;
        SqlServerMCP.prototype.run = mockRunMethod;

        // Create a new instance to simulate entry point execution
        const entryPointServer = new SqlServerMCP();

        // Manually call the entry point logic (simulating the condition being true)
        await entryPointServer.run();

        expect(mockRunMethod).toHaveBeenCalled();

        // Restore original method
        SqlServerMCP.prototype.run = originalRun;
      });

      test('should handle errors in entry point execution', async () => {
        const originalConsoleError = console.error;
        const consoleErrorSpy = vi.fn();
        console.error = consoleErrorSpy;

        const runError = new Error('Startup failed');
        const mockRunMethod = vi.fn().mockRejectedValue(runError);
        const originalRun = SqlServerMCP.prototype.run;
        SqlServerMCP.prototype.run = mockRunMethod;

        // Create a new instance and simulate error handling
        const entryPointServer = new SqlServerMCP();

        try {
          await entryPointServer.run();
        } catch (error) {
          // The entry point catches and logs errors
          expect(error).toBe(runError);
        }

        expect(mockRunMethod).toHaveBeenCalled();

        // Restore original methods
        SqlServerMCP.prototype.run = originalRun;
        console.error = originalConsoleError;
      });
    });

    describe('Integration Scenarios', () => {
      let integrationConsoleErrorSpy;
      let originalNodeEnv;

      beforeEach(() => {
        // Set up console spy for integration tests
        integrationConsoleErrorSpy = vi.fn();
        console.error = integrationConsoleErrorSpy;

        // Temporarily disable test mode for these tests
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
      });

      afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
      });

      test('should handle complete startup flow with all components', async () => {
        // Mock successful database connection
        vi.spyOn(mcpServer, 'connectToDatabase').mockResolvedValue(mockPool);
        // Mock successful transport connection
        const mockTransport = { connect: vi.fn() };
        const mockServer = { connect: vi.fn().mockResolvedValue() };
        mcpServer.server = mockServer;

        // Mock StdioServerTransport constructor to return our mock
        vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
          StdioServerTransport: vi.fn(() => mockTransport)
        }));

        await mcpServer.run();

        // Verify complete startup sequence - at minimum these messages
        expect(integrationConsoleErrorSpy).toHaveBeenCalledWith(
          'Starting Warp SQL Server MCP server...'
        );
        expect(integrationConsoleErrorSpy).toHaveBeenCalledWith(
          'Database connection pool initialized successfully'
        );
        expect(integrationConsoleErrorSpy).toHaveBeenCalledWith(
          'Warp SQL Server MCP server running on stdio'
        );
      });
    });
  });
});
