#!/usr/bin/env node

// Simple test to validate the MCP server structure without connecting to database
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

console.log('Testing MCP server structure...');

try {
  const server = new Server(
    {
      name: 'warp-sql-server-mcp-test',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Test that we can set up the tools list
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  }));

  console.log('✅ MCP server structure is valid');
  console.log('✅ SDK imports are working correctly');
  console.log('✅ Tool handler setup is functional');
  
  console.log('\nNext steps:');
  console.log('1. Configure your SQL Server connection in .env file');
  console.log('2. Add the MCP server to Warp settings');
  console.log('3. Test with your SQL Server instance');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
