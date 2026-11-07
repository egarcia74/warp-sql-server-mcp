/** Independent legacy ordering oracle, always called with a synthetic isolated environment. */
import fs from 'node:fs';
import dotenv from 'dotenv';
// macOS injects this unrelated process-launch setting even for an explicit env map.
delete process.env.__CF_USER_TEXT_ENCODING;
const values = JSON.parse(fs.readFileSync(0, 'utf8'));
for (const [key, value] of Object.entries(values)) if (!process.env[key]) process.env[key] = value;
const result = dotenv.config({ debug: false, quiet: true });
process.stdout.write(JSON.stringify({ environment: process.env, errorCode: result.error?.code }));
