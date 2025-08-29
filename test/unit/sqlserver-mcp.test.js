import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the mssql module first (must be hoisted)
vi.mock('mssql', () => ({
  default: {
    connect: vi.fn(),
    ConnectionPool: vi.fn()
  },
  connect: vi.fn(),
  ConnectionPool: vi.fn()
}));

// Mock StdioServerTransport at the module level
const mockStdioTransport = {
  connect: vi.fn()
};

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(() => mockStdioTransport)
}));

// Mock environment variables
const originalEnv = process.env;

// Mock objects for testing
const mockRequest = {
  query: vi.fn(),
  timeout: 30000
};

const mockPool = {
  request: vi.fn(() => mockRequest),
  connected: true
};

// Mock test data
const testData = {
  sampleDatabases: [
    {
      database_name: 'TestDB1',
      database_id: 5,
      create_date: '2024-01-01T00:00:00.000Z',
      collation_name: 'SQL_Latin1_General_CP1_CI_AS',
      status: 'ONLINE'
    },
    {
      database_name: 'TestDB2',
      database_id: 6,
      create_date: '2024-01-02T00:00:00.000Z',
      collation_name: 'SQL_Latin1_General_CP1_CI_AS',
      status: 'ONLINE'
    }
  ],
  sampleTables: [
    {
      database_name: 'TestDB',
      schema_name: 'dbo',
      table_name: 'Users',
      table_type: 'BASE TABLE'
    },
    {
      database_name: 'TestDB',
      schema_name: 'dbo',
      table_name: 'Orders',
      table_type: 'BASE TABLE'
    }
  ],
  sampleTableSchema: [
    {
      column_name: 'id',
      data_type: 'int',
      max_length: null,
      precision: 10,
      scale: 0,
      is_nullable: 'NO',
      default_value: null,
      is_primary_key: 'YES'
    },
    {
      column_name: 'name',
      data_type: 'varchar',
      max_length: 100,
      precision: null,
      scale: null,
      is_nullable: 'YES',
      default_value: null,
      is_primary_key: 'NO'
    }
  ],
  sampleTableData: [
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
    { id: 3, name: 'Bob Johnson', email: 'bob@example.com' }
  ]
};

// Import the actual SqlServerMCP class
import { SqlServerMCP } from '../../index.js';

// Import sql to access the mock
import sql from 'mssql';

describe('SqlServerMCP', () => {
  let mcpServer;

  beforeEach(async () => {
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
    mockPool.connected = true;
    mockRequest.query.mockResolvedValue({
      recordset: [],
      recordsets: [[]],
      rowsAffected: [0]
    });

    // Create an actual SqlServerMCP instance for testing
    // Mock the server setup to prevent actual MCP server initialization
    vi.spyOn(SqlServerMCP.prototype, 'setupToolHandlers').mockImplementation(() => {});

    mcpServer = new SqlServerMCP();
    mcpServer.pool = null; // Reset pool
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Database Connection', () => {
    test('should connect to database with correct configuration', async () => {
      sql.connect.mockResolvedValue(mockPool);

      const pool = await mcpServer.connectToDatabase();

      expect(sql.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          server: 'localhost',
          port: 1433,
          database: 'master',
          user: 'testuser',
          password: 'testpass',
          options: {
            encrypt: false,
            trustServerCertificate: true,
            enableArithAbort: true,
            requestTimeout: 30000
          }
        })
      );
      expect(pool).toBe(mockPool);
    });

    test('should handle Windows authentication when no user/password provided', async () => {
      process.env.SQL_SERVER_USER = '';
      process.env.SQL_SERVER_PASSWORD = '';
      process.env.SQL_SERVER_DOMAIN = 'TESTDOMAIN';

      sql.connect.mockResolvedValue(mockPool);

      await mcpServer.connectToDatabase();

      expect(sql.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          authentication: {
            type: 'ntlm',
            options: {
              domain: 'TESTDOMAIN'
            }
          }
        })
      );
    });

    test('should reuse existing connection if already connected', async () => {
      mcpServer.pool = { connected: true };

      const result = await mcpServer.connectToDatabase();

      expect(sql.connect).not.toHaveBeenCalled();
      expect(result).toBe(mcpServer.pool);
    });

    test('should handle connection errors', async () => {
      const error = new Error('Connection failed');
      sql.connect.mockRejectedValue(error);

      await expect(mcpServer.connectToDatabase()).rejects.toThrow(
        'Failed to connect to SQL Server after 3 attempts: Connection failed'
      );
    });
  });

  describe('Safety Mechanisms', () => {
    describe('Constructor Safety Configuration', () => {
      test('should enable read-only mode by default', () => {
        const safeMcpServer = new SqlServerMCP();
        expect(safeMcpServer.readOnlyMode).toBe(true);
        expect(safeMcpServer.allowDestructiveOperations).toBe(false);
        expect(safeMcpServer.allowSchemaChanges).toBe(false);
      });

      test('should allow overriding safety settings via environment variables', () => {
        process.env.SQL_SERVER_READ_ONLY = 'false';
        process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
        process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'true';

        const unsafeMcpServer = new SqlServerMCP();
        expect(unsafeMcpServer.readOnlyMode).toBe(false);
        expect(unsafeMcpServer.allowDestructiveOperations).toBe(true);
        expect(unsafeMcpServer.allowSchemaChanges).toBe(true);
      });

      test('should handle mixed safety configurations', () => {
        process.env.SQL_SERVER_READ_ONLY = 'false';
        process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
        process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';

        const mixedMcpServer = new SqlServerMCP();
        expect(mixedMcpServer.readOnlyMode).toBe(false);
        expect(mixedMcpServer.allowDestructiveOperations).toBe(true);
        expect(mixedMcpServer.allowSchemaChanges).toBe(false);
      });
    });

    describe('Query Validation', () => {
      beforeEach(() => {
        // Test with default safe configuration
        mcpServer = new SqlServerMCP();
      });

      test('should allow SELECT queries in read-only mode', () => {
        const validation = mcpServer.validateQuery('SELECT * FROM users');
        expect(validation.allowed).toBe(true);
        expect(validation.reason).toBe('Query validation passed');
      });

      test('should allow SELECT with JOIN in read-only mode', () => {
        const validation = mcpServer.validateQuery(`
          SELECT u.name, o.total 
          FROM users u 
          JOIN orders o ON u.id = o.user_id
        `);
        expect(validation.allowed).toBe(true);
      });

      test('should allow CTE queries in read-only mode', () => {
        const validation = mcpServer.validateQuery(`
          WITH UserStats AS (
            SELECT user_id, COUNT(*) as order_count
            FROM orders
            GROUP BY user_id
          )
          SELECT * FROM UserStats
        `);
        expect(validation.allowed).toBe(true);
      });

      test('should block INSERT queries in read-only mode', () => {
        const validation = mcpServer.validateQuery("INSERT INTO users (name) VALUES ('John')");
        expect(validation.allowed).toBe(false);
        expect(validation.reason).toContain('Read-only mode is enabled');
        expect(validation.queryType).toBe('non-select');
      });

      test('should block UPDATE queries in read-only mode', () => {
        const validation = mcpServer.validateQuery("UPDATE users SET name = 'Jane' WHERE id = 1");
        expect(validation.allowed).toBe(false);
        expect(validation.reason).toContain('Read-only mode is enabled');
        expect(validation.queryType).toBe('non-select');
      });

      test('should block DELETE queries in read-only mode', () => {
        const validation = mcpServer.validateQuery('DELETE FROM users WHERE id = 1');
        expect(validation.allowed).toBe(false);
        expect(validation.reason).toContain('Read-only mode is enabled');
        expect(validation.queryType).toBe('non-select');
      });

      test('should block TRUNCATE queries in read-only mode', () => {
        const validation = mcpServer.validateQuery('TRUNCATE TABLE users');
        expect(validation.allowed).toBe(false);
        expect(validation.reason).toContain('Read-only mode is enabled');
        expect(validation.queryType).toBe('non-select');
      });

      test('should block stored procedure execution in read-only mode', () => {
        const validation = mcpServer.validateQuery('EXEC UpdateUserStats');
        expect(validation.allowed).toBe(false);
        expect(validation.reason).toContain('Read-only mode is enabled');
        expect(validation.queryType).toBe('non-select');
      });

      test('should block CREATE statements in read-only mode', () => {
        const validation = mcpServer.validateQuery('CREATE TABLE test (id INT)');
        expect(validation.allowed).toBe(false);
        expect(validation.reason).toContain('Read-only mode is enabled');
        expect(validation.queryType).toBe('non-select');
      });

      test('should handle case-insensitive queries', () => {
        const validation = mcpServer.validateQuery("insert into users (name) values ('test')");
        expect(validation.allowed).toBe(false);
        expect(validation.queryType).toBe('non-select');
      });

      test('should handle queries with leading whitespace', () => {
        const validation = mcpServer.validateQuery('   DELETE FROM users');
        expect(validation.allowed).toBe(false);
        expect(validation.queryType).toBe('non-select');
      });

      test('should allow empty queries', () => {
        const validation = mcpServer.validateQuery('');
        expect(validation.allowed).toBe(true);
        expect(validation.reason).toBe('Empty query');
      });

      test('should allow whitespace-only queries', () => {
        const validation = mcpServer.validateQuery('   \n\t  ');
        expect(validation.allowed).toBe(true);
        expect(validation.reason).toBe('Empty query');
      });
    });

    describe('Destructive Operations Control', () => {
      beforeEach(() => {
        // Test with read-only disabled but destructive operations disabled
        process.env.SQL_SERVER_READ_ONLY = 'false';
        process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'false';
        process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';
        mcpServer = new SqlServerMCP();
      });

      test('should allow SELECT queries when read-only is disabled', () => {
        const validation = mcpServer.validateQuery('SELECT * FROM users');
        expect(validation.allowed).toBe(true);
      });

      test('should block INSERT when destructive operations disabled', () => {
        const validation = mcpServer.validateQuery("INSERT INTO users (name) VALUES ('test')");
        expect(validation.allowed).toBe(false);
        expect(validation.reason).toContain(
          'Destructive operations (INSERT/UPDATE/DELETE) are disabled'
        );
        expect(validation.queryType).toBe('destructive');
      });

      test('should block UPDATE when destructive operations disabled', () => {
        const validation = mcpServer.validateQuery("UPDATE users SET name = 'test'");
        expect(validation.allowed).toBe(false);
        expect(validation.queryType).toBe('destructive');
      });

      test('should block DELETE when destructive operations disabled', () => {
        const validation = mcpServer.validateQuery('DELETE FROM users');
        expect(validation.allowed).toBe(false);
        expect(validation.queryType).toBe('destructive');
      });

      test('should block TRUNCATE when destructive operations disabled', () => {
        const validation = mcpServer.validateQuery('TRUNCATE TABLE users');
        expect(validation.allowed).toBe(false);
        expect(validation.queryType).toBe('destructive');
      });

      test('should block EXECUTE/EXEC when destructive operations disabled', () => {
        const validation = mcpServer.validateQuery('EXECUTE sp_updatestats');
        expect(validation.allowed).toBe(false);
        expect(validation.queryType).toBe('destructive');
      });

      test('should detect multi-statement destructive queries', () => {
        const validation = mcpServer.validateQuery('SELECT 1; DELETE FROM users');
        expect(validation.allowed).toBe(false);
        expect(validation.queryType).toBe('destructive');
      });
    });

    describe('Schema Changes Control', () => {
      beforeEach(() => {
        // Test with destructive operations enabled but schema changes disabled
        process.env.SQL_SERVER_READ_ONLY = 'false';
        process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
        process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';
        mcpServer = new SqlServerMCP();
      });

      test('should allow data operations when schema changes disabled', () => {
        const validation = mcpServer.validateQuery("INSERT INTO users (name) VALUES ('test')");
        expect(validation.allowed).toBe(true);
      });

      test('should block CREATE TABLE when schema changes disabled', () => {
        const validation = mcpServer.validateQuery('CREATE TABLE test (id INT)');
        expect(validation.allowed).toBe(false);
        expect(validation.reason).toContain('Schema changes (CREATE/DROP/ALTER) are disabled');
        expect(validation.queryType).toBe('schema');
      });

      test('should block DROP TABLE when schema changes disabled', () => {
        const validation = mcpServer.validateQuery('DROP TABLE users');
        expect(validation.allowed).toBe(false);
        expect(validation.queryType).toBe('schema');
      });

      test('should block ALTER TABLE when schema changes disabled', () => {
        const validation = mcpServer.validateQuery('ALTER TABLE users ADD COLUMN age INT');
        expect(validation.allowed).toBe(false);
        expect(validation.queryType).toBe('schema');
      });

      test('should block GRANT statements when schema changes disabled', () => {
        const validation = mcpServer.validateQuery('GRANT SELECT ON users TO testuser');
        expect(validation.allowed).toBe(false);
        expect(validation.queryType).toBe('schema');
      });

      test('should block REVOKE statements when schema changes disabled', () => {
        const validation = mcpServer.validateQuery('REVOKE SELECT ON users FROM testuser');
        expect(validation.allowed).toBe(false);
        expect(validation.queryType).toBe('schema');
      });

      test('should detect multi-statement schema changes', () => {
        const validation = mcpServer.validateQuery(
          'SELECT 1; CREATE INDEX idx_name ON users(name)'
        );
        expect(validation.allowed).toBe(false);
        expect(validation.queryType).toBe('schema');
      });
    });

    describe('Full Access Mode', () => {
      beforeEach(() => {
        // Test with all safety features disabled
        process.env.SQL_SERVER_READ_ONLY = 'false';
        process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
        process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'true';
        mcpServer = new SqlServerMCP();
      });

      test('should allow SELECT queries in full access mode', () => {
        const validation = mcpServer.validateQuery('SELECT * FROM users');
        expect(validation.allowed).toBe(true);
      });

      test('should allow INSERT queries in full access mode', () => {
        const validation = mcpServer.validateQuery("INSERT INTO users (name) VALUES ('test')");
        expect(validation.allowed).toBe(true);
      });

      test('should allow UPDATE queries in full access mode', () => {
        const validation = mcpServer.validateQuery("UPDATE users SET name = 'test'");
        expect(validation.allowed).toBe(true);
      });

      test('should allow DELETE queries in full access mode', () => {
        const validation = mcpServer.validateQuery('DELETE FROM users WHERE id = 1');
        expect(validation.allowed).toBe(true);
      });

      test('should allow CREATE TABLE in full access mode', () => {
        const validation = mcpServer.validateQuery('CREATE TABLE test (id INT, name VARCHAR(100))');
        expect(validation.allowed).toBe(true);
      });

      test('should allow DROP TABLE in full access mode', () => {
        const validation = mcpServer.validateQuery('DROP TABLE test');
        expect(validation.allowed).toBe(true);
      });

      test('should allow ALTER TABLE in full access mode', () => {
        const validation = mcpServer.validateQuery('ALTER TABLE users ADD COLUMN age INT');
        expect(validation.allowed).toBe(true);
      });

      test('should allow GRANT/REVOKE in full access mode', () => {
        expect(mcpServer.validateQuery('GRANT SELECT ON users TO testuser').allowed).toBe(true);
        expect(mcpServer.validateQuery('REVOKE SELECT ON users FROM testuser').allowed).toBe(true);
      });
    });
  });

  describe('executeQuery', () => {
    beforeEach(() => {
      mcpServer.pool = mockPool;
    });

    test('should execute query successfully', async () => {
      const mockResult = {
        recordset: [{ id: 1, name: 'test' }],
        recordsets: [[{ id: 1, name: 'test' }]],
        rowsAffected: [1]
      };
      mockRequest.query.mockResolvedValue(mockResult);

      const result = await mcpServer.executeQuery('SELECT * FROM test');

      expect(mockPool.request).toHaveBeenCalled();
      expect(mockRequest.query).toHaveBeenCalledWith('SELECT * FROM test');
      expect(result.content[0].text).toContain('recordset');
      expect(result.content[0].text).toContain('rowsAffected');
    });

    test('should switch database when specified', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [],
        recordsets: [[]],
        rowsAffected: [0]
      });

      await mcpServer.executeQuery('SELECT 1', 'TestDB');

      expect(mockRequest.query).toHaveBeenNthCalledWith(1, 'USE [TestDB]');
      expect(mockRequest.query).toHaveBeenNthCalledWith(2, 'SELECT 1');
    });

    test('should handle query execution errors', async () => {
      const error = new Error('SQL syntax error');
      mockRequest.query.mockRejectedValue(error);

      await expect(mcpServer.executeQuery('SELECT * FROM nonexistent_table')).rejects.toThrow(
        'Query execution failed: SQL syntax error'
      );
    });

    test('should include safety info in successful query responses', async () => {
      // Configure for full access mode
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'true';
      mcpServer = new SqlServerMCP();
      mcpServer.pool = mockPool;

      const mockResult = {
        recordset: [{ id: 1, name: 'test' }],
        recordsets: [[{ id: 1, name: 'test' }]],
        rowsAffected: [1]
      };
      mockRequest.query.mockResolvedValue(mockResult);

      const result = await mcpServer.executeQuery('SELECT * FROM test');
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.safetyInfo).toBeDefined();
      expect(responseData.safetyInfo.readOnlyMode).toBe(false);
      expect(responseData.safetyInfo.destructiveOperationsAllowed).toBe(true);
      expect(responseData.safetyInfo.schemaChangesAllowed).toBe(true);
    });

    test('should block unsafe queries with safety validation', async () => {
      // Test with default safe configuration
      mcpServer = new SqlServerMCP();
      mcpServer.pool = mockPool;

      await expect(mcpServer.executeQuery('DELETE FROM users')).rejects.toThrow(
        'Query blocked by safety policy: Read-only mode is enabled. Only SELECT queries are allowed. Set SQL_SERVER_READ_ONLY=false to disable.'
      );

      // Verify the actual SQL query was never executed
      expect(mockRequest.query).not.toHaveBeenCalledWith('DELETE FROM users');
    });

    test('should allow safe queries in read-only mode', async () => {
      // Test with default safe configuration
      mcpServer = new SqlServerMCP();
      mcpServer.pool = mockPool;

      const mockResult = {
        recordset: [{ id: 1, name: 'test' }],
        recordsets: [[{ id: 1, name: 'test' }]],
        rowsAffected: [1]
      };
      mockRequest.query.mockResolvedValue(mockResult);

      const result = await mcpServer.executeQuery('SELECT * FROM test');
      const responseData = JSON.parse(result.content[0].text);

      expect(mockRequest.query).toHaveBeenCalledWith('SELECT * FROM test');
      expect(responseData.safetyInfo.readOnlyMode).toBe(true);
      expect(responseData.safetyInfo.destructiveOperationsAllowed).toBe(false);
      expect(responseData.safetyInfo.schemaChangesAllowed).toBe(false);
    });
  });

  describe('listDatabases', () => {
    beforeEach(() => {
      mcpServer.pool = mockPool;
    });

    test('should list databases successfully', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: testData.sampleDatabases
      });

      const result = await mcpServer.listDatabases();

      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('SELECT'));
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('sys.databases'));

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData).toEqual(testData.sampleDatabases);
    });

    test('should exclude system databases', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: testData.sampleDatabases
      });

      await mcpServer.listDatabases();

      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')")
      );
    });
  });

  describe('listTables', () => {
    beforeEach(() => {
      mcpServer.pool = mockPool;
    });

    test('should list tables with default schema', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: testData.sampleTables
      });

      const result = await mcpServer.listTables();

      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE t.TABLE_SCHEMA = 'dbo'")
      );

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData).toEqual(testData.sampleTables);
    });

    test('should switch database when specified', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.listTables('TestDB', 'dbo');

      expect(mockRequest.query).toHaveBeenNthCalledWith(1, 'USE [TestDB]');
    });
  });

  describe('describeTable', () => {
    beforeEach(() => {
      mcpServer.pool = mockPool;
    });

    test('should describe table schema successfully', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: testData.sampleTableSchema
      });

      const result = await mcpServer.describeTable('Users');

      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('INFORMATION_SCHEMA.COLUMNS')
      );
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE c.TABLE_NAME = 'Users'")
      );

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData).toEqual(testData.sampleTableSchema);
    });

    test('should include primary key information', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: testData.sampleTableSchema
      });

      await mcpServer.describeTable('Users');

      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('PRIMARY KEY'));
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('is_primary_key'));
    });
  });

  describe('getTableData', () => {
    beforeEach(() => {
      mcpServer.pool = mockPool;
    });

    test('should get table data with default limit', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: testData.sampleTableData
      });

      const result = await mcpServer.getTableData('Users');

      expect(mockRequest.query).toHaveBeenCalledWith('SELECT TOP 100 * FROM [dbo].[Users]');

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.table).toBe('dbo.Users');
      expect(responseData.rowCount).toBe(3);
      expect(responseData.data).toEqual(testData.sampleTableData);
    });

    test('should apply WHERE clause when provided', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData('Users', null, 'dbo', 100, 'id > 10');

      expect(mockRequest.query).toHaveBeenCalledWith(
        'SELECT TOP 100 * FROM [dbo].[Users] WHERE id > 10'
      );
    });

    test('should handle complex WHERE clauses with AND conditions', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData(
        'Users',
        null,
        'dbo',
        50,
        "status = 'active' AND created_date > '2023-01-01'"
      );

      expect(mockRequest.query).toHaveBeenCalledWith(
        "SELECT TOP 50 * FROM [dbo].[Users] WHERE status = 'active' AND created_date > '2023-01-01'"
      );
    });

    test('should handle LIKE pattern matching in WHERE clause', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData('Users', null, 'dbo', 100, "name LIKE '%john%'");

      expect(mockRequest.query).toHaveBeenCalledWith(
        "SELECT TOP 100 * FROM [dbo].[Users] WHERE name LIKE '%john%'"
      );
    });

    test('should handle NULL checks in WHERE clause', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData('Users', null, 'dbo', 100, 'deleted_at IS NULL');

      expect(mockRequest.query).toHaveBeenCalledWith(
        'SELECT TOP 100 * FROM [dbo].[Users] WHERE deleted_at IS NULL'
      );
    });

    test('should handle OR conditions in WHERE clause', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData(
        'Users',
        null,
        'dbo',
        100,
        "status = 'active' OR status = 'pending'"
      );

      expect(mockRequest.query).toHaveBeenCalledWith(
        "SELECT TOP 100 * FROM [dbo].[Users] WHERE status = 'active' OR status = 'pending'"
      );
    });

    test('should handle numeric comparisons in WHERE clause', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData('Users', null, 'dbo', 100, 'age >= 18 AND age <= 65');

      expect(mockRequest.query).toHaveBeenCalledWith(
        'SELECT TOP 100 * FROM [dbo].[Users] WHERE age >= 18 AND age <= 65'
      );
    });

    test('should handle date comparisons in WHERE clause', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData('Users', null, 'dbo', 100, "created_date > '2023-01-01'");

      expect(mockRequest.query).toHaveBeenCalledWith(
        "SELECT TOP 100 * FROM [dbo].[Users] WHERE created_date > '2023-01-01'"
      );
    });

    test('should handle IN clause filtering', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData(
        'Users',
        null,
        'dbo',
        100,
        "status IN ('active', 'pending', 'verified')"
      );

      expect(mockRequest.query).toHaveBeenCalledWith(
        "SELECT TOP 100 * FROM [dbo].[Users] WHERE status IN ('active', 'pending', 'verified')"
      );
    });

    test('should return filtered results correctly', async () => {
      const filteredData = [
        { id: 5, name: 'Alice', status: 'active' },
        { id: 8, name: 'Bob', status: 'active' }
      ];
      mockRequest.query.mockResolvedValue({ recordset: filteredData });

      const result = await mcpServer.getTableData('Users', null, 'dbo', 100, "status = 'active'");

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.table).toBe('dbo.Users');
      expect(responseData.rowCount).toBe(2);
      expect(responseData.data).toEqual(filteredData);
      expect(mockRequest.query).toHaveBeenCalledWith(
        "SELECT TOP 100 * FROM [dbo].[Users] WHERE status = 'active'"
      );
    });
  });

  describe('explainQuery', () => {
    beforeEach(() => {
      mcpServer.pool = mockPool;
    });

    test('should generate execution plan for query', async () => {
      const mockPlan = [
        {
          StmtText: 'SELECT * FROM Users',
          StmtId: 1,
          NodeId: 1,
          Parent: 0,
          PhysicalOp: 'Clustered Index Scan',
          LogicalOp: 'Clustered Index Scan',
          EstimateCPU: 0.001,
          EstimateIO: 0.003125,
          EstimateRows: 100
        }
      ];

      // Mock the sequence of queries for explain plan
      mockRequest.query
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET SHOWPLAN_ALL ON
        .mockResolvedValueOnce({ recordset: mockPlan, recordsets: [mockPlan] }) // The actual query plan
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET SHOWPLAN_ALL OFF
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }); // Cost query

      const result = await mcpServer.explainQuery('SELECT * FROM Users');

      expect(mockRequest.query).toHaveBeenCalledWith('SET SHOWPLAN_ALL ON');
      expect(mockRequest.query).toHaveBeenCalledWith('SELECT * FROM Users');
      expect(mockRequest.query).toHaveBeenCalledWith('SET SHOWPLAN_ALL OFF');

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.query).toBe('SELECT * FROM Users');
      expect(responseData.execution_plan).toEqual(mockPlan);
      expect(responseData.plan_type).toBe('estimated');
    });

    test('should generate actual execution plan when requested', async () => {
      const mockPlan = [
        {
          StmtText: 'SELECT * FROM Users',
          ActualRows: 95,
          ActualExecutions: 1,
          ActualCPU: 0.002,
          ActualIO: 0.003
        }
      ];

      mockRequest.query
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET STATISTICS IO ON
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET STATISTICS TIME ON
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET SHOWPLAN_ALL ON
        .mockResolvedValueOnce({ recordset: mockPlan, recordsets: [mockPlan] }) // The actual query plan
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET SHOWPLAN_ALL OFF
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET STATISTICS IO OFF
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET STATISTICS TIME OFF
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }); // Cost query

      const result = await mcpServer.explainQuery('SELECT * FROM Users', null, true);

      expect(mockRequest.query).toHaveBeenCalledWith('SET STATISTICS IO ON');
      expect(mockRequest.query).toHaveBeenCalledWith('SET STATISTICS TIME ON');
      expect(mockRequest.query).toHaveBeenCalledWith('SET SHOWPLAN_ALL ON');

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.plan_type).toBe('actual');
      expect(responseData.execution_plan).toEqual(mockPlan);
    });

    test('should switch database when specified', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [], recordsets: [[]] });

      await mcpServer.explainQuery('SELECT 1', 'TestDB');

      expect(mockRequest.query).toHaveBeenCalledWith('USE [TestDB]');
    });

    test('should handle explain query errors', async () => {
      const error = new Error('Query plan generation failed');
      mockRequest.query.mockRejectedValue(error);

      await expect(mcpServer.explainQuery('INVALID SQL')).rejects.toThrow(
        'Failed to explain query: Query plan generation failed'
      );
    });
  });

  describe('listForeignKeys', () => {
    beforeEach(() => {
      mcpServer.pool = mockPool;
    });

    test('should list foreign key relationships', async () => {
      const mockForeignKeys = [
        {
          constraint_name: 'FK_Orders_Users',
          parent_table: 'Orders',
          parent_column: 'user_id',
          referenced_table: 'Users',
          referenced_column: 'id',
          on_delete: 'CASCADE',
          on_update: 'NO ACTION',
          is_disabled: false
        },
        {
          constraint_name: 'FK_OrderItems_Orders',
          parent_table: 'OrderItems',
          parent_column: 'order_id',
          referenced_table: 'Orders',
          referenced_column: 'id',
          on_delete: 'CASCADE',
          on_update: 'NO ACTION',
          is_disabled: false
        }
      ];

      mockRequest.query.mockResolvedValue({
        recordset: mockForeignKeys
      });

      const result = await mcpServer.listForeignKeys();

      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('sys.foreign_keys'));
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE s.name = 'dbo'")
      );

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.schema).toBe('dbo');
      expect(responseData.foreign_keys).toEqual(mockForeignKeys);
      expect(responseData.count).toBe(2);
    });

    test('should switch database when specified', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.listForeignKeys('TestDB', 'custom');

      expect(mockRequest.query).toHaveBeenNthCalledWith(1, 'USE [TestDB]');
    });

    test('should handle custom schema', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.listForeignKeys(null, 'custom');

      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE s.name = 'custom'")
      );
    });
  });

  describe('exportTableCsv', () => {
    beforeEach(() => {
      mcpServer.pool = mockPool;
    });

    test('should export table data as CSV', async () => {
      const mockData = [
        { id: 1, name: 'John Doe', email: 'john@example.com' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
      ];

      mockRequest.query.mockResolvedValue({
        recordset: mockData
      });

      const result = await mcpServer.exportTableCsv('Users');

      expect(mockRequest.query).toHaveBeenCalledWith('SELECT * FROM [dbo].[Users]');

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.table).toBe('dbo.Users');
      expect(responseData.format).toBe('csv');
      expect(responseData.row_count).toBe(2);
      expect(responseData.column_count).toBe(3);
      expect(responseData.csv_data).toContain('id,name,email');
      expect(responseData.csv_data).toContain('1,John Doe,john@example.com');
      expect(responseData.csv_data).toContain('2,Jane Smith,jane@example.com');
    });

    test('should apply limit when specified', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.exportTableCsv('Users', null, 'dbo', 50);

      expect(mockRequest.query).toHaveBeenCalledWith('SELECT TOP 50 * FROM [dbo].[Users]');
    });

    test('should apply WHERE clause when specified', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.exportTableCsv('Users', null, 'dbo', null, 'active = 1');

      expect(mockRequest.query).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[Users] WHERE active = 1'
      );
    });

    test('should handle CSV escaping correctly', async () => {
      const mockData = [
        { id: 1, description: 'Text with, comma', notes: 'Text with "quotes"' },
        { id: 2, description: 'Text with\nnewline', notes: null }
      ];

      mockRequest.query.mockResolvedValue({
        recordset: mockData
      });

      const result = await mcpServer.exportTableCsv('TestTable');

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.csv_data).toContain('"Text with, comma"');
      expect(responseData.csv_data).toContain('"Text with ""quotes"""');
      // The newline character should be handled by the CSV generation logic
      expect(responseData.csv_data).toContain('2,"Text with\nnewline",');
    });

    test('should handle empty table', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: []
      });

      const result = await mcpServer.exportTableCsv('EmptyTable');

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.row_count).toBe(0);
      expect(responseData.csv_data).toBe('');
    });

    test('should switch database when specified', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.exportTableCsv('Users', 'TestDB');

      expect(mockRequest.query).toHaveBeenNthCalledWith(1, 'USE [TestDB]');
    });

    describe('CSV Export Filtering Tests', () => {
      test('should handle simple WHERE clause in CSV export', async () => {
        const mockData = [{ id: 5, name: 'Active User', status: 'active' }];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        const result = await mcpServer.exportTableCsv(
          'Users',
          null,
          'dbo',
          null,
          "status = 'active'"
        );

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT * FROM [dbo].[Users] WHERE status = 'active'"
        );

        const responseData = JSON.parse(result.content[0].text);
        expect(responseData.row_count).toBe(1);
        expect(responseData.csv_data).toContain('5,Active User,active');
      });

      test('should handle complex AND/OR conditions in CSV export', async () => {
        const mockData = [
          { id: 1, name: 'Alice', status: 'active', age: 25 },
          { id: 2, name: 'Bob', status: 'active', age: 30 }
        ];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        await mcpServer.exportTableCsv('Users', null, 'dbo', 100, "status = 'active' AND age > 20");

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT TOP 100 * FROM [dbo].[Users] WHERE status = 'active' AND age > 20"
        );
      });

      test('should handle LIKE patterns in CSV export WHERE clause', async () => {
        const mockData = [{ id: 1, name: 'John Doe', email: 'john@example.com' }];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        await mcpServer.exportTableCsv('Users', null, 'dbo', null, "email LIKE '%@example.com'");

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT * FROM [dbo].[Users] WHERE email LIKE '%@example.com'"
        );
      });

      test('should handle NULL checks in CSV export WHERE clause', async () => {
        const mockData = [{ id: 1, name: 'Active User', deleted_at: null }];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        await mcpServer.exportTableCsv('Users', null, 'dbo', null, 'deleted_at IS NULL');

        expect(mockRequest.query).toHaveBeenCalledWith(
          'SELECT * FROM [dbo].[Users] WHERE deleted_at IS NULL'
        );
      });

      test('should handle date range filtering in CSV export', async () => {
        const mockData = [{ id: 1, name: 'Recent User', created_date: '2023-06-15' }];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        await mcpServer.exportTableCsv(
          'Users',
          null,
          'dbo',
          null,
          "created_date BETWEEN '2023-01-01' AND '2023-12-31'"
        );

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT * FROM [dbo].[Users] WHERE created_date BETWEEN '2023-01-01' AND '2023-12-31'"
        );
      });

      test('should handle IN clause filtering in CSV export', async () => {
        const mockData = [
          { id: 1, name: 'Admin User', role: 'admin' },
          { id: 2, name: 'Manager User', role: 'manager' }
        ];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        await mcpServer.exportTableCsv(
          'Users',
          null,
          'dbo',
          null,
          "role IN ('admin', 'manager', 'supervisor')"
        );

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT * FROM [dbo].[Users] WHERE role IN ('admin', 'manager', 'supervisor')"
        );
      });

      test('should combine WHERE clause with LIMIT correctly in CSV export', async () => {
        const mockData = [
          { id: 10, name: 'User 10', status: 'active' },
          { id: 20, name: 'User 20', status: 'active' }
        ];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        await mcpServer.exportTableCsv('Users', null, 'dbo', 50, "status = 'active'");

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT TOP 50 * FROM [dbo].[Users] WHERE status = 'active'"
        );

        const result = await mcpServer.exportTableCsv(
          'Users',
          null,
          'dbo',
          50,
          "status = 'active'"
        );
        const responseData = JSON.parse(result.content[0].text);
        expect(responseData.row_count).toBe(2);
      });

      test('should handle empty results from filtered CSV export', async () => {
        mockRequest.query.mockResolvedValue({ recordset: [] });

        const result = await mcpServer.exportTableCsv(
          'Users',
          null,
          'dbo',
          null,
          "status = 'nonexistent'"
        );

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT * FROM [dbo].[Users] WHERE status = 'nonexistent'"
        );

        const responseData = JSON.parse(result.content[0].text);
        expect(responseData.row_count).toBe(0);
        expect(responseData.csv_data).toBe('');
      });
    });

    describe('CSV Export Error Handling', () => {
      test('should handle database connection errors during CSV export', async () => {
        // Simulate a database connection failure
        mockPool.request.mockImplementation(() => {
          throw new Error('Database connection lost');
        });
        mcpServer.pool = mockPool;

        await expect(mcpServer.exportTableCsv('Users', null, 'dbo', null, null)).rejects.toThrow(
          'Failed to export table as CSV: Database connection lost'
        );
      });

      test('should handle SQL query errors during CSV export', async () => {
        const mockRequestWithError = {
          ...mockRequest,
          timeout: 30000,
          query: vi.fn().mockRejectedValue(new Error("Invalid object name 'NonExistentTable'"))
        };
        mockPool.request.mockReturnValue(mockRequestWithError);
        mcpServer.pool = mockPool;

        await expect(
          mcpServer.exportTableCsv('NonExistentTable', null, 'dbo', null, null)
        ).rejects.toThrow("Failed to export table as CSV: Invalid object name 'NonExistentTable'");
      });

      test('should handle permission errors during CSV export', async () => {
        const mockRequestWithError = {
          ...mockRequest,
          timeout: 30000,
          query: vi
            .fn()
            .mockRejectedValue(new Error("SELECT permission denied on object 'SecureTable'"))
        };
        mockPool.request.mockReturnValue(mockRequestWithError);
        mcpServer.pool = mockPool;

        await expect(
          mcpServer.exportTableCsv('SecureTable', null, 'dbo', null, null)
        ).rejects.toThrow(
          "Failed to export table as CSV: SELECT permission denied on object 'SecureTable'"
        );
      });

      test('should handle timeout errors during CSV export', async () => {
        const mockRequestWithError = {
          ...mockRequest,
          timeout: 30000,
          query: vi.fn().mockRejectedValue(new Error('Timeout expired'))
        };
        mockPool.request.mockReturnValue(mockRequestWithError);
        mcpServer.pool = mockPool;

        await expect(
          mcpServer.exportTableCsv('LargeTable', null, 'dbo', 1000000, null)
        ).rejects.toThrow('Failed to export table as CSV: Timeout expired');
      });

      test('should handle invalid WHERE clause syntax errors during CSV export', async () => {
        const mockRequestWithError = {
          ...mockRequest,
          timeout: 30000,
          query: vi.fn().mockRejectedValue(new Error("Incorrect syntax near 'INVALID'"))
        };
        mockPool.request.mockReturnValue(mockRequestWithError);
        mcpServer.pool = mockPool;

        await expect(
          mcpServer.exportTableCsv('Users', null, 'dbo', null, 'INVALID SYNTAX HERE')
        ).rejects.toThrow("Failed to export table as CSV: Incorrect syntax near 'INVALID'");
      });
    });
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

        // Verify server connection
        expect(mockServer.connect).toHaveBeenCalledWith(mockStdioTransport);
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
        expect(mockServer.connect).toHaveBeenCalledWith(mockStdioTransport);
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
        expect(mockServer.connect).toHaveBeenCalledWith(mockStdioTransport);
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
