const scenario = process.env.CONNECTIVITY_TEST_CASE;

const listResponse = values => [{ type: 'text', text: values }];

export class SqlServerMCP {
  constructor() {
    if (process.env.MCP_TESTING_MODE !== 'docker') {
      throw new Error('docker testing mode was not set before initialization');
    }
    if (scenario === 'initialization-error') throw new Error('stub initialization error');

    this.databaseTools = {
      listDatabases: async () => {
        if (scenario === 'database-error') throw new Error('stub database error');
        if (scenario === 'database-invalid') return [{ type: 'image', text: 'invalid' }];
        if (scenario === 'empty-lists') return listResponse('No data returned');
        return listResponse('Database\n--------\nmaster\n\nWarpMcpTest\n');
      },
      listTables: async database => {
        if (database !== 'WarpMcpTest') throw new Error('unexpected database name');
        if (scenario === 'table-error') throw new Error('stub table error');
        if (scenario === 'table-invalid') return null;
        if (scenario === 'empty-lists') return listResponse('No data returned');
        return listResponse('Table\n-----\nCustomers\n\nOrders\n');
      }
    };
  }

  async executeQuery(query) {
    if (query !== 'SELECT @@VERSION as Version') throw new Error('unexpected query');
    if (scenario === 'query-error') throw new Error('stub query error');
    if (scenario === 'query-invalid') return { content: null };
    if (scenario === 'query-no-version') return { content: [{ text: 'No result' }] };
    if (scenario === 'query-no-year') return { content: [{ text: 'Version: SQL Server' }] };
    return { content: [{ text: 'Version: SQL Server 2022' }] };
  }
}
