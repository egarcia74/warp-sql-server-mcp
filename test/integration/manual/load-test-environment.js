import dotenv from 'dotenv';

export function loadTestEnvironment() {
  dotenv.config({ quiet: true });
  if (process.env.MCP_TESTING_MODE === 'docker') {
    dotenv.config({ path: './test/docker/.env.docker', override: true, quiet: true });
  }
}
