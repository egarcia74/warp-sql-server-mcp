#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

/**
 * Extracts MCP tool documentation from the main index.js file
 * This parses the tools array in setupToolHandlers() and extracts structured information
 */

function extractToolsFromCode() {
  const indexPath = path.resolve('index.js');
  const content = fs.readFileSync(indexPath, 'utf8');

  // Find the tools array in setupToolHandlers method
  const toolsRegex = /tools:\s*\[\s*([\s\S]*?)\s*\]\s*\}\)\);/;
  const match = content.match(toolsRegex);

  if (!match) {
    throw new Error('Could not find tools array in index.js');
  }

  const toolsArrayContent = match[1];

  // Split by tool object boundaries - look for },\n and parse each individually
  const toolObjects = [];

  // First, let's use a more sophisticated approach to split tool objects
  const toolParts = splitToolObjects(toolsArrayContent);

  toolParts.forEach(toolPart => {
    const tool = parseIndividualTool(toolPart);
    if (tool) {
      toolObjects.push(tool);
    }
  });

  return toolObjects;
}

function splitToolObjects(content) {
  // Split by tool object boundaries, but be careful with nested braces
  const parts = [];
  let current = '';
  let braceDepth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const prevChar = i > 0 ? content[i - 1] : '';

    current += char;

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false;
      stringChar = '';
    } else if (!inString) {
      if (char === '{') {
        braceDepth++;
      } else if (char === '}') {
        braceDepth--;

        // If we're back to depth 0, we've completed a tool object
        if (braceDepth === 0) {
          parts.push(current.trim());
          current = '';
        }
      }
    }
  }

  // Add any remaining content
  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.filter(part => part.includes('name:') && part.includes('description:'));
}

function parseIndividualTool(toolContent) {
  // Extract name
  const nameRegex = /name:\s*['"`]([^'"`]+)['"`]/;
  const nameMatch = toolContent.match(nameRegex);

  // Extract description
  const descriptionRegex = /description:\s*['"`]([^'"`]+)['"`]/;
  const descriptionMatch = toolContent.match(descriptionRegex);

  if (!nameMatch || !descriptionMatch) {
    return null;
  }

  const name = nameMatch[1];
  const description = descriptionMatch[1];

  // Extract input schema
  const inputSchemaRegex = /inputSchema:\s*\{([\s\S]*?)\}\s*$/;
  const inputSchemaMatch = toolContent.match(inputSchemaRegex);

  let properties = {};
  let required = [];

  if (inputSchemaMatch) {
    const schemaContent = inputSchemaMatch[1];
    properties = parseInputSchemaProperties(schemaContent);
    required = parseRequiredFields(schemaContent);
  }

  return {
    name,
    description,
    parameters: properties,
    required: required || []
  };
}

function parseInputSchemaProperties(schemaContent) {
  const properties = {};

  // First, extract the entire properties block
  const propertiesRegex = /properties:\s*\{([\s\S]*?)\}(?:\s*,?\s*required|\s*$)/;
  const propertiesMatch = schemaContent.match(propertiesRegex);

  if (!propertiesMatch) {
    return properties;
  }

  const propertiesContent = propertiesMatch[1];

  // Now parse individual property objects by splitting them properly
  const propObjects = splitPropertyObjects(propertiesContent);

  propObjects.forEach(propObj => {
    const parsed = parseIndividualProperty(propObj);
    if (parsed) {
      properties[parsed.name] = {
        type: parsed.type,
        description: parsed.description
      };
    }
  });

  return properties;
}

function splitPropertyObjects(content) {
  const parts = [];
  let current = '';
  let braceDepth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const prevChar = i > 0 ? content[i - 1] : '';

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false;
      stringChar = '';
    }

    if (!inString) {
      if (char === '{') {
        braceDepth++;
        current += char;
      } else if (char === '}') {
        braceDepth--;
        current += char;

        // If we're back to depth 0, we've completed a property object
        if (braceDepth === 0) {
          parts.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    } else {
      current += char;
    }
  }

  // Add any remaining content
  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.filter(part => part.includes(':') && part.includes('{'));
}

function parseIndividualProperty(propContent) {
  // Extract property name (the key before the colon)
  const nameRegex = /(\w+):\s*\{/;
  const nameMatch = propContent.match(nameRegex);

  // Extract type
  const typeRegex = /type:\s*['"`]([^'"`]+)['"`]/;
  const typeMatch = propContent.match(typeRegex);

  // Extract description
  const descRegex = /description:\s*['"`]([^'"`]+)['"`]/;
  const descMatch = propContent.match(descRegex);

  if (!nameMatch || !typeMatch || !descMatch) {
    return null;
  }

  return {
    name: nameMatch[1],
    type: typeMatch[1],
    description: descMatch[1]
  };
}

function parseRequiredFields(schemaContent) {
  const requiredRegex = /required:\s*\[([\s\S]*?)\]/;
  const requiredMatch = schemaContent.match(requiredRegex);

  if (!requiredMatch) {
    return [];
  }

  const requiredContent = requiredMatch[1];
  const fieldRegex = /['"`]([^'"`]+)['"`]/g;
  const required = [];

  let fieldMatch;
  while ((fieldMatch = fieldRegex.exec(requiredContent)) !== null) {
    required.push(fieldMatch[1]);
  }

  return required;
}

function generateExamples(toolName, parameters, required) {
  const examples = {
    basic: {},
    advanced: {}
  };

  // Generate basic example with only required parameters
  required.forEach(param => {
    if (parameters[param]) {
      switch (parameters[param].type) {
        case 'string':
          if (param.includes('query')) {
            examples.basic[param] = 'SELECT * FROM your_table';
          } else if (param.includes('table')) {
            examples.basic[param] = 'your_table_name';
          } else if (param.includes('database')) {
            examples.basic[param] = 'your_database';
          } else {
            examples.basic[param] = 'example_value';
          }
          break;
        case 'number':
          examples.basic[param] = param === 'limit' ? 100 : 1;
          break;
        case 'boolean':
          examples.basic[param] = false;
          break;
        default:
          examples.basic[param] = 'example_value';
      }
    }
  });

  // Generate advanced example with optional parameters
  examples.advanced = { ...examples.basic };
  Object.keys(parameters).forEach(param => {
    if (!required.includes(param)) {
      switch (parameters[param].type) {
        case 'string':
          if (param === 'database') {
            examples.advanced[param] = 'MyDatabase';
          } else if (param === 'schema') {
            examples.advanced[param] = 'dbo';
          } else if (param === 'where') {
            examples.advanced[param] = 'id > 100';
          } else {
            examples.advanced[param] = 'optional_value';
          }
          break;
        case 'number':
          examples.advanced[param] = param === 'limit' ? 50 : 1;
          break;
        case 'boolean':
          examples.advanced[param] = true;
          break;
      }
    }
  });

  return examples;
}

function generateToolsDocumentation() {
  console.log('Extracting MCP tools documentation...');

  try {
    const tools = extractToolsFromCode();
    console.log(`Found ${tools.length} MCP tools`);

    // Add examples to each tool
    const enhancedTools = tools.map(tool => ({
      ...tool,
      examples: generateExamples(tool.name, tool.parameters, tool.required)
    }));

    // Generate the documentation data
    const docData = {
      version: getPackageVersion(),
      generatedAt: new Date().toISOString(),
      toolsCount: enhancedTools.length,
      tools: enhancedTools
    };

    // Save to a JSON file that can be used by the GitHub Actions workflow
    const outputDir = 'docs-data';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(path.join(outputDir, 'tools.json'), JSON.stringify(docData, null, 2));

    console.log('Documentation data saved to docs-data/tools.json');
    return docData;
  } catch (error) {
    console.error('Error extracting documentation:', error.message);
    process.exit(1);
  }
}

function getPackageVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    return packageJson.version;
  } catch {
    return '1.0.0';
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const docData = generateToolsDocumentation();

  // Output summary for GitHub Actions
  console.log('\n📊 Documentation Summary:');
  console.log(`Version: ${docData.version}`);
  console.log(`Tools: ${docData.toolsCount}`);
  docData.tools.forEach(tool => {
    console.log(`  • ${tool.name}: ${tool.description}`);
  });
}

export { generateToolsDocumentation };
