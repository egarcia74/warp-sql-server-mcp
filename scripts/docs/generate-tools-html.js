#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

/**
 * Generates the detailed tools documentation HTML page
 * Uses the extracted tools data from docs-data/tools.json
 */

function generateToolsHTML() {
  // Read the extracted tools data
  const toolsDataPath = path.resolve('docs-data/tools.json');

  if (!fs.existsSync(toolsDataPath)) {
    throw new Error('Tools data file not found. Run extract-docs.js first.');
  }

  const toolsData = JSON.parse(fs.readFileSync(toolsDataPath, 'utf8'));
  const { version, tools } = toolsData;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP Tools - Warp SQL Server MCP Documentation</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
            color: #333;
        }
        .header {
            text-align: center;
            margin-bottom: 3rem;
            padding: 2rem;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 8px;
        }
        .nav {
            margin-bottom: 2rem;
            padding: 1rem;
            background: #f8f9fa;
            border-radius: 8px;
            text-align: center;
        }
        .nav a {
            color: #007bff;
            text-decoration: none;
            margin: 0 1rem;
            font-weight: 500;
        }
        .nav a:hover {
            text-decoration: underline;
        }
        .tool {
            background: white;
            margin: 2rem 0;
            padding: 2rem;
            border-radius: 8px;
            border: 1px solid #e9ecef;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .tool h2 {
            color: #495057;
            margin-top: 0;
            border-bottom: 2px solid #007bff;
            padding-bottom: 0.5rem;
        }
        .tool-name {
            font-family: 'Monaco', 'Consolas', monospace;
            background: #f1f3f4;
            padding: 0.2rem 0.5rem;
            border-radius: 3px;
            font-size: 1.1em;
        }
        .description {
            font-size: 1.1em;
            margin: 1rem 0;
            color: #6c757d;
        }
        .section {
            margin: 1.5rem 0;
        }
        .section h3 {
            color: #495057;
            margin-bottom: 0.5rem;
        }
        .parameters-table {
            width: 100%;
            border-collapse: collapse;
            margin: 1rem 0;
        }
        .parameters-table th,
        .parameters-table td {
            padding: 0.75rem;
            text-align: left;
            border-bottom: 1px solid #dee2e6;
        }
        .parameters-table th {
            background-color: #f8f9fa;
            font-weight: 600;
            color: #495057;
        }
        .param-name {
            font-family: 'Monaco', 'Consolas', monospace;
            font-weight: 600;
            color: #007bff;
        }
        .param-type {
            font-family: 'Monaco', 'Consolas', monospace;
            background: #e9ecef;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            font-size: 0.9em;
        }
        .required {
            background: #dc3545;
            color: white;
            padding: 0.1rem 0.3rem;
            border-radius: 3px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .optional {
            background: #28a745;
            color: white;
            padding: 0.1rem 0.3rem;
            border-radius: 3px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .example {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 5px;
            padding: 1rem;
            margin: 0.5rem 0;
        }
        .example h4 {
            margin-top: 0;
            color: #495057;
        }
        .example-code {
            background: #2d3748;
            color: #e2e8f0;
            padding: 1rem;
            border-radius: 5px;
            font-family: 'Monaco', 'Consolas', monospace;
            font-size: 0.9em;
            overflow-x: auto;
            white-space: pre-wrap;
            margin: 0.5rem 0;
        }
        .no-params {
            color: #6c757d;
            font-style: italic;
            text-align: center;
            padding: 1rem;
        }
        .toc {
            background: #f8f9fa;
            padding: 1.5rem;
            border-radius: 8px;
            margin-bottom: 2rem;
        }
        .toc h3 {
            margin-top: 0;
            color: #495057;
        }
        .toc ul {
            margin: 0.5rem 0;
        }
        .toc a {
            color: #007bff;
            text-decoration: none;
        }
        .toc a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🛠️ MCP Tools Documentation</h1>
        <p>Detailed reference for all available SQL Server MCP tools</p>
        <div>
            <strong>Version ${version} • ${tools.length} Tools Available</strong>
        </div>
    </div>

    <div class="nav">
        <a href="./">← Back to Main Documentation</a>
        <a href="#toc">Table of Contents</a>
        <a href="https://github.com/egarcia74/warp-sql-server-mcp">GitHub Repository</a>
    </div>

    <div class="toc" id="toc">
        <h3>📋 Table of Contents</h3>
        <ul>
${tools.map(tool => `            <li><a href="#${tool.name}">${tool.name}</a> - ${tool.description}</li>`).join('\n')}
        </ul>
    </div>

${tools.map(tool => generateToolSection(tool)).join('\n\n')}

    <footer style="margin-top: 3rem; text-align: center; color: #6c757d; border-top: 1px solid #e9ecef; padding-top: 1rem;">
        <p>Generated automatically from code • Last updated: ${new Date().toLocaleDateString()}</p>
    </footer>
</body>
</html>`;

  return html;
}

function generateToolSection(tool) {
  const { name, description, parameters, required, examples } = tool;
  const hasParameters = Object.keys(parameters).length > 0;

  return `    <div class="tool" id="${name}">
        <h2><span class="tool-name">${name}</span></h2>
        <div class="description">${description}</div>
        
        <div class="section">
            <h3>📝 Parameters</h3>
            ${hasParameters ? generateParametersTable(parameters, required) : '<div class="no-params">No parameters required</div>'}
        </div>
        
        <div class="section">
            <h3>💡 Examples</h3>
            ${generateExamples(name, examples)}
        </div>
    </div>`;
}

function generateParametersTable(parameters, required) {
  const paramEntries = Object.entries(parameters);

  if (paramEntries.length === 0) {
    return '<div class="no-params">No parameters required</div>';
  }

  const tableRows = paramEntries.map(([paramName, paramInfo]) => {
    const isRequired = required.includes(paramName);
    const requiredBadge = isRequired
      ? '<span class="required">REQUIRED</span>'
      : '<span class="optional">OPTIONAL</span>';

    return `                <tr>
                    <td><span class="param-name">${paramName}</span></td>
                    <td><span class="param-type">${paramInfo.type}</span></td>
                    <td>${requiredBadge}</td>
                    <td>${paramInfo.description}</td>
                </tr>`;
  });

  return `            <table class="parameters-table">
                <thead>
                    <tr>
                        <th>Parameter</th>
                        <th>Type</th>
                        <th>Required</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
${tableRows.join('\n')}
                </tbody>
            </table>`;
}

function generateExamples(toolName, examples) {
  const { basic, advanced } = examples;
  const hasBasicExample = Object.keys(basic).length > 0;
  const hasAdvancedExample = Object.keys(advanced).length > 0;

  let exampleHtml = '';

  if (hasBasicExample) {
    exampleHtml += `            <div class="example">
                <h4>🔹 Basic Usage</h4>
                <div class="example-code">${JSON.stringify({ tool: toolName, arguments: basic }, null, 2)}</div>
            </div>`;
  }

  if (hasAdvancedExample && JSON.stringify(basic) !== JSON.stringify(advanced)) {
    exampleHtml += `            <div class="example">
                <h4>🔸 Advanced Usage</h4>
                <div class="example-code">${JSON.stringify({ tool: toolName, arguments: advanced }, null, 2)}</div>
            </div>`;
  }

  if (!hasBasicExample && !hasAdvancedExample) {
    exampleHtml = `            <div class="example">
                <h4>🔹 Usage</h4>
                <div class="example-code">${JSON.stringify({ tool: toolName, arguments: {} }, null, 2)}</div>
            </div>`;
  }

  return exampleHtml;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log('Generating detailed tools documentation...');
    const html = generateToolsHTML();

    // Ensure docs directory exists
    const docsDir = 'docs';
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }

    // Write the HTML file
    fs.writeFileSync(path.join(docsDir, 'tools.html'), html);
    console.log('✅ Tools documentation generated: docs/tools.html');
  } catch (error) {
    console.error('❌ Error generating tools documentation:', error.message);
    process.exit(1);
  }
}

export { generateToolsHTML };
