import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

import {
  assertDockerCredentialStorageSupported,
  assertPrivateDockerFile
} from './detect-platform.js';

const requiredFields = [
  'SQL_SERVER_HOST',
  'SQL_SERVER_PORT',
  'SQL_SERVER_USER',
  'SQL_SERVER_PASSWORD'
];

export function loadRequiredDockerEnvironment(
  environment = process.env,
  envPath = path.join(process.cwd(), 'test/docker/.env.docker')
) {
  if (environment.MCP_TESTING_MODE !== 'docker') {
    throw new Error('Docker testing mode is required to load the generated environment');
  }
  assertDockerCredentialStorageSupported();

  let descriptor;
  try {
    descriptor = fs.openSync(envPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Generated Docker environment is required: ${envPath}`, { cause: error });
    }
    throw error;
  }

  let parsed;
  try {
    assertPrivateDockerFile(fs.fstatSync(descriptor), envPath);
    parsed = dotenv.parse(fs.readFileSync(descriptor, 'utf8'));
  } finally {
    fs.closeSync(descriptor);
  }

  if (
    parsed.MCP_TESTING_MODE !== 'docker' ||
    requiredFields.some(field => !parsed[field]?.trim())
  ) {
    throw new Error(`Generated Docker environment is incomplete: ${envPath}`);
  }

  Object.assign(environment, parsed);
  return parsed;
}
