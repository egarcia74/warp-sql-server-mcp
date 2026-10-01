import dotenv from 'dotenv';
import { loadRequiredDockerEnvironment } from '../../docker/load-docker-environment.js';

export function loadTestEnvironment() {
  dotenv.config({ quiet: true });
  if (process.env.MCP_TESTING_MODE === 'docker') {
    loadRequiredDockerEnvironment();
  }
}
