#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { getAllTools } from '../../lib/tools/tool-registry.js';

function exampleValue(param, schema, advanced) {
  if (schema.enum?.length) return schema.enum[0];
  const { type } = schema;
  if (type === 'number' || type === 'integer') return param === 'limit' ? (advanced ? 50 : 100) : 1;
  if (type === 'boolean') return advanced;
  if (param.includes('query')) return 'SELECT * FROM your_table';
  if (param.includes('table')) return 'your_table_name';
  if (param === 'database') return advanced ? 'MyDatabase' : 'your_database';
  if (param === 'schema') return 'dbo';
  if (param === 'where') return 'id > 100';
  return advanced ? 'optional_value' : 'example_value';
}

function generateExamples(parameters, required) {
  const basic = Object.fromEntries(
    required
      .filter(param => parameters[param])
      .map(param => [param, exampleValue(param, parameters[param], false)])
  );
  const advanced = { ...basic };
  for (const [param, schema] of Object.entries(parameters)) {
    if (!required.includes(param)) advanced[param] = exampleValue(param, schema, true);
  }
  return { basic, advanced };
}

function getPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  } catch {
    return '1.0.0';
  }
}

function preserveTimestampIfUnchanged(docData) {
  try {
    if (!fs.existsSync('docs-data/tools.json')) return;
    const previous = JSON.parse(fs.readFileSync('docs-data/tools.json', 'utf8'));
    const normalize = data => {
      const copy = globalThis.structuredClone(data);
      delete copy.generatedAt;
      return copy;
    };
    if (JSON.stringify(normalize(previous)) === JSON.stringify(normalize(docData))) {
      docData.generatedAt = previous.generatedAt || docData.generatedAt;
    }
  } catch {
    // A missing or malformed previous snapshot must not prevent regeneration.
  }
}

export function generateToolsDocumentation(registryTools = getAllTools()) {
  const tools = registryTools.map(tool => {
    const {
      properties = {},
      required: requiredFields = [],
      ...rootSchema
    } = tool.inputSchema ?? {};
    const schema = globalThis.structuredClone(rootSchema);
    const parameters = globalThis.structuredClone(properties);
    const required = [...requiredFields];
    return {
      name: tool.name,
      description: tool.description,
      schema,
      parameters,
      required,
      examples: generateExamples(parameters, required)
    };
  });

  const docData = {
    version: getPackageVersion(),
    generatedAt: new Date().toISOString(),
    toolsCount: tools.length,
    tools
  };

  const outputDir = 'docs-data';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, 'tools.json');
  preserveTimestampIfUnchanged(docData);
  fs.writeFileSync(outPath, JSON.stringify(docData, null, 2));

  try {
    execSync('npx prettier --write docs-data/tools.json', { stdio: 'inherit' });
  } catch {
    console.log('Documentation data saved to docs-data/tools.json (formatting skipped)');
  }
  return docData;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const docData = generateToolsDocumentation();
  console.log(`Documentation data saved: ${docData.toolsCount} MCP tools`);
}
