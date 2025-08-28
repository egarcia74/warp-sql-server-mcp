#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import sql from 'mssql';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class SqlServerMCP {
  constructor() {
    this.server = new Server(
      {
        name: 'warp-sql-server-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.pool = null;
    this.setupToolHandlers();
  }

  async connectToDatabase() {
    if (this.pool && this.pool.connected) {
      return this.pool;
    }

    const config = {
      server: process.env.SQL_SERVER_HOST || 'localhost',
      port: parseInt(process.env.SQL_SERVER_PORT) || 1433,
      database: process.env.SQL_SERVER_DATABASE || 'master',
      user: process.env.SQL_SERVER_USER,
      password: process.env.SQL_SERVER_PASSWORD,
      options: {
        encrypt: process.env.SQL_SERVER_ENCRYPT === 'true' || false,
        trustServerCertificate: process.env.SQL_SERVER_TRUST_CERT === 'true' || true,
        enableArithAbort: true,
        requestTimeout: 30000,
      },
    };

    // Handle Windows Authentication if no user/password provided
    if (!config.user && !config.password) {
      config.authentication = {
        type: 'ntlm',
        options: {
          domain: process.env.SQL_SERVER_DOMAIN || '',
        }
      };
    }

    try {
      this.pool = await sql.connect(config);
      console.error('Connected to SQL Server successfully');
      return this.pool;
    } catch (error) {
      console.error('Failed to connect to SQL Server:', error.message);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to connect to SQL Server: ${error.message}`
      );
    }
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'execute_query',
          description: 'Execute a SQL query on the connected SQL Server database',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The SQL query to execute',
              },
              database: {
                type: 'string',
                description: 'Optional: Database name to use for this query',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'list_databases',
          description: 'List all databases on the SQL Server instance',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'list_tables',
          description: 'List all tables in a specific database',
          inputSchema: {
            type: 'object',
            properties: {
              database: {
                type: 'string',
                description: 'Database name (optional, uses current database if not specified)',
              },
              schema: {
                type: 'string',
                description: 'Schema name (optional, defaults to dbo)',
              },
            },
          },
        },
        {
          name: 'describe_table',
          description: 'Get the schema information for a specific table',
          inputSchema: {
            type: 'object',
            properties: {
              table_name: {
                type: 'string',
                description: 'Name of the table to describe',
              },
              database: {
                type: 'string',
                description: 'Database name (optional)',
              },
              schema: {
                type: 'string',
                description: 'Schema name (optional, defaults to dbo)',
              },
            },
            required: ['table_name'],
          },
        },
        {
          name: 'get_table_data',
          description: 'Get sample data from a table with optional filtering and limiting',
          inputSchema: {
            type: 'object',
            properties: {
              table_name: {
                type: 'string',
                description: 'Name of the table',
              },
              database: {
                type: 'string',
                description: 'Database name (optional)',
              },
              schema: {
                type: 'string',
                description: 'Schema name (optional, defaults to dbo)',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of rows to return (optional, defaults to 100)',
              },
              where: {
                type: 'string',
                description: 'WHERE clause conditions (optional)',
              },
            },
            required: ['table_name'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        await this.connectToDatabase();

        switch (name) {
          case 'execute_query':
            return await this.executeQuery(args.query, args.database);
          
          case 'list_databases':
            return await this.listDatabases();
          
          case 'list_tables':
            return await this.listTables(args.database, args.schema);
          
          case 'describe_table':
            return await this.describeTable(args.table_name, args.database, args.schema);
          
          case 'get_table_data':
            return await this.getTableData(
              args.table_name,
              args.database,
              args.schema,
              args.limit,
              args.where
            );
          
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${error.message}`
        );
      }
    });
  }

  async executeQuery(query, database = null) {
    try {
      const request = this.pool.request();
      
      if (database) {
        await request.query(`USE [${database}]`);
      }

      const result = await request.query(query);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              rowsAffected: result.rowsAffected,
              recordset: result.recordset,
              recordsets: result.recordsets,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Query execution failed: ${error.message}`
      );
    }
  }

  async listDatabases() {
    try {
      const result = await this.pool.request().query(`
        SELECT 
          name as database_name,
          database_id,
          create_date,
          collation_name,
          state_desc as status
        FROM sys.databases 
        WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
        ORDER BY name
      `);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.recordset, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list databases: ${error.message}`
      );
    }
  }

  async listTables(database = null, schema = 'dbo') {
    try {
      let query = `
        SELECT 
          t.TABLE_CATALOG as database_name,
          t.TABLE_SCHEMA as schema_name,
          t.TABLE_NAME as table_name,
          t.TABLE_TYPE as table_type
        FROM INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = '${schema}'
        ORDER BY t.TABLE_NAME
      `;

      const request = this.pool.request();
      
      if (database) {
        await request.query(`USE [${database}]`);
      }

      const result = await request.query(query);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.recordset, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list tables: ${error.message}`
      );
    }
  }

  async describeTable(tableName, database = null, schema = 'dbo') {
    try {
      const request = this.pool.request();
      
      if (database) {
        await request.query(`USE [${database}]`);
      }

      const result = await request.query(`
        SELECT 
          c.COLUMN_NAME as column_name,
          c.DATA_TYPE as data_type,
          c.CHARACTER_MAXIMUM_LENGTH as max_length,
          c.NUMERIC_PRECISION as precision,
          c.NUMERIC_SCALE as scale,
          c.IS_NULLABLE as is_nullable,
          c.COLUMN_DEFAULT as default_value,
          CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'YES' ELSE 'NO' END as is_primary_key
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN (
          SELECT ku.COLUMN_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku 
            ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          WHERE tc.TABLE_NAME = '${tableName}'
            AND tc.TABLE_SCHEMA = '${schema}'
            AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
        WHERE c.TABLE_NAME = '${tableName}' 
          AND c.TABLE_SCHEMA = '${schema}'
        ORDER BY c.ORDINAL_POSITION
      `);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.recordset, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to describe table: ${error.message}`
      );
    }
  }

  async getTableData(tableName, database = null, schema = 'dbo', limit = 100, whereClause = null) {
    try {
      const request = this.pool.request();
      
      if (database) {
        await request.query(`USE [${database}]`);
      }

      let query = `SELECT TOP ${limit} * FROM [${schema}].[${tableName}]`;
      
      if (whereClause) {
        query += ` WHERE ${whereClause}`;
      }

      const result = await request.query(query);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              table: `${schema}.${tableName}`,
              rowCount: result.recordset.length,
              data: result.recordset,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get table data: ${error.message}`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Warp SQL Server MCP server running on stdio');
  }
}

const server = new SqlServerMCP();
server.run().catch(console.error);
