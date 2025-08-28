import { vi } from 'vitest';

// Mock the mssql module
const mockPool = {
  connected: true,
  request: vi.fn(),
  connect: vi.fn(),
  close: vi.fn()
};

const mockRequest = {
  query: vi.fn(),
  input: vi.fn(),
  execute: vi.fn()
};

// Default mock implementation
mockPool.request.mockReturnValue(mockRequest);
mockRequest.query.mockResolvedValue({
  recordset: [],
  recordsets: [[]],
  rowsAffected: [0]
});

const sqlMock = {
  connect: vi.fn().mockResolvedValue(mockPool),
  ConnectionPool: vi.fn().mockImplementation(() => mockPool),
  Request: vi.fn().mockImplementation(() => mockRequest),
  TYPES: {
    VarChar: 'VarChar',
    Int: 'Int',
    DateTime: 'DateTime'
  }
};

// Mock the mssql module
vi.mock('mssql', () => ({
  default: sqlMock,
  ...sqlMock
}));

// Mock dotenv
vi.mock('dotenv', () => ({
  default: {
    config: vi.fn()
  },
  config: vi.fn()
}));

// Global test utilities
globalThis.mockSql = sqlMock;
globalThis.mockPool = mockPool;
globalThis.mockRequest = mockRequest;

// Global test data
globalThis.testData = {
  sampleDatabases: [
    {
      database_name: 'TestDB',
      database_id: 5,
      create_date: '2023-01-01T00:00:00.000Z',
      collation_name: 'SQL_Latin1_General_CP1_CI_AS',
      status: 'ONLINE'
    },
    {
      database_name: 'SampleDB',
      database_id: 6,
      create_date: '2023-02-01T00:00:00.000Z',
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
      column_name: 'username',
      data_type: 'varchar',
      max_length: 50,
      precision: null,
      scale: null,
      is_nullable: 'NO',
      default_value: null,
      is_primary_key: 'NO'
    },
    {
      column_name: 'email',
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
    { id: 1, username: 'john_doe', email: 'john@example.com' },
    { id: 2, username: 'jane_smith', email: 'jane@example.com' },
    { id: 3, username: 'bob_wilson', email: 'bob@example.com' }
  ]
};
