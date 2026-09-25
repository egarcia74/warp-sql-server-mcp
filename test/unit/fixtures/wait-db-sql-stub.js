const scenario = process.env.WAIT_DB_SCENARIO;
let nextId = 1;

function trace(event, id, extra = {}) {
  process.stderr.write(`WAIT_DB_TRACE:${JSON.stringify({ event, id, ...extra })}\n`);
}

export class ConnectionPool {
  constructor(config) {
    this.id = nextId++;
    if (config.database !== 'master' || config.pool?.max !== 1) {
      throw new Error('unexpected readiness pool configuration');
    }
    trace('construct', this.id);
  }

  async connect() {
    trace('connect', this.id);
    if (scenario === 'always-fail' || (scenario === 'success-fifth' && this.id < 5)) {
      throw new Error(`connect failure ${this.id}`);
    }
    return this;
  }

  request() {
    trace('request', this.id);
    return {
      query: async statement => {
        trace('query', this.id, { statement });
        if (scenario === 'query-fails-once' && this.id === 1) {
          throw new Error('query failure 1');
        }
        return { recordset: [{ Version: 'SQL Server 2022' }] };
      }
    };
  }

  async close() {
    trace('close', this.id);
    if (scenario === 'close-fails-once' && this.id === 1) {
      throw new Error('close failure 1');
    }
  }
}

export default { ConnectionPool };
