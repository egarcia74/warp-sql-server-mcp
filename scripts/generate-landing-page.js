#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

/**
 * Generates the landing page HTML with dynamic tool information
 */

function generateLandingPageHTML() {
  // Read the extracted tools data
  const toolsDataPath = path.resolve('docs-data/tools.json');

  if (!fs.existsSync(toolsDataPath)) {
    throw new Error('Tools data file not found. Run extract-docs.js first.');
  }

  const toolsData = JSON.parse(fs.readFileSync(toolsDataPath, 'utf8'));
  const { version, tools } = toolsData;

  // Generate tool list HTML
  const toolListHTML = tools
    .map(tool => {
      // Convert tool names from snake_case to camelCase for display (like the original hardcoded list)
      const displayName = tool.name.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
      return `                          <li><span class="code">${displayName}</span> - ${tool.description}</li>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Warp SQL Server MCP - Documentation</title>
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
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
            margin: 2rem 0;
        }
        .card {
            background: #f8f9fa;
            padding: 1.5rem;
            border-radius: 8px;
            border: 1px solid #e9ecef;
            transition: transform 0.2s ease;
        }
        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .card h3 {
            margin-top: 0;
            color: #495057;
        }
        .card p {
            color: #6c757d;
        }
        .card a {
            color: #007bff;
            text-decoration: none;
            font-weight: 500;
        }
        .card a:hover {
            text-decoration: underline;
        }
        .badge {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            background: #28a745;
            color: white;
            border-radius: 3px;
            font-size: 0.75rem;
            margin: 0.25rem;
        }
        .code {
            background: #f1f3f4;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            font-family: 'Monaco', 'Consolas', monospace;
            font-size: 0.9em;
        }
        .tools-preview {
            max-height: 200px;
            overflow-y: auto;
            border: 1px solid #e9ecef;
            border-radius: 5px;
            padding: 1rem;
            margin: 1rem 0;
        }
        .tools-preview ul {
            margin: 0;
            padding-left: 1.2rem;
        }
        .tools-preview li {
            margin-bottom: 0.3rem;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🗄️ Warp SQL Server MCP</h1>
        <p>Model Context Protocol server for SQL Server integration with Warp terminal</p>
        <div>
            <span class="badge">v${version}</span>
            <span class="badge">Node.js 18+</span>
            <span class="badge">MCP</span>
            <span class="badge">SQL Server</span>
            <span class="badge">${tools.length} Tools</span>
        </div>
    </div>

    <div class="grid">
        <div class="card">
            <h3>📖 README</h3>
            <p>Complete setup guide, installation instructions, and usage examples.</p>
            <a href="https://github.com/egarcia74/warp-sql-server-mcp#readme">View README →</a>
        </div>

        <div class="card">
            <h3>🚀 Latest Release</h3>
            <p>Download the latest version and view the changelog.</p>
            <a href="https://github.com/egarcia74/warp-sql-server-mcp/releases/latest">Download v${version} →</a>
        </div>

        <div class="card">
            <h3>🧪 Test Coverage</h3>
            <p>View detailed test coverage reports and test results.</p>
            <a href="./coverage/index.html">Coverage Report →</a>
        </div>

        <div class="card">
            <h3>🛠️ MCP Tools Reference</h3>
            <p>Comprehensive documentation for all ${tools.length} available MCP tools with parameters, examples, and usage details.</p>
            <a href="./tools.html">View Full API Documentation →</a>
        </div>

        <div class="card">
            <h3>📋 Available Tools</h3>
            <p>Quick overview of MCP tools provided by this server:</p>
            <div class="tools-preview">
                <ul>
${toolListHTML}
                </ul>
            </div>
            <a href="./tools.html">View detailed documentation →</a>
        </div>

        <div class="card">
            <h3>⚙️ Configuration</h3>
            <p>Environment variables and configuration options:</p>
            <ul>
                <li><span class="code">SQL_SERVER_HOST</span> - SQL Server hostname</li>
                <li><span class="code">SQL_SERVER_PORT</span> - SQL Server port (default: 1433)</li>
                <li><span class="code">SQL_SERVER_DATABASE</span> - Initial database (default: master)</li>
                <li><span class="code">SQL_SERVER_USER</span> - SQL Server username (optional)</li>
                <li><span class="code">SQL_SERVER_PASSWORD</span> - SQL Server password (optional)</li>
                <li><span class="code">SQL_SERVER_ENCRYPT</span> - Enable encryption (default: false)</li>
                <li><span class="code">SQL_SERVER_TRUST_CERT</span> - Trust server certificate (default: true)</li>
            </ul>
        </div>

        <div class="card">
            <h3>🔗 Links</h3>
            <p>Useful resources and links:</p>
            <ul>
                <li><a href="https://github.com/egarcia74/warp-sql-server-mcp">GitHub Repository</a></li>
                <li><a href="https://github.com/egarcia74/warp-sql-server-mcp/issues">Report Issues</a></li>
                <li><a href="https://modelcontextprotocol.io/docs">MCP Documentation</a></li>
                <li><a href="https://www.warp.dev/">Warp Terminal</a></li>
            </ul>
        </div>
    </div>

    <footer style="margin-top: 3rem; text-align: center; color: #6c757d; border-top: 1px solid #e9ecef; padding-top: 1rem;">
        <p>Built with ❤️ for the MCP ecosystem | Documentation generated automatically</p>
    </footer>
</body>
</html>`;

  return html;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log('Generating landing page documentation...');
    const html = generateLandingPageHTML();

    // Ensure docs directory exists
    const docsDir = 'docs';
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }

    // Write the HTML file
    fs.writeFileSync(path.join(docsDir, 'index.html'), html);
    console.log('✅ Landing page generated: docs/index.html');
  } catch (error) {
    console.error('❌ Error generating landing page:', error.message);
    process.exit(1);
  }
}

export { generateLandingPageHTML };
