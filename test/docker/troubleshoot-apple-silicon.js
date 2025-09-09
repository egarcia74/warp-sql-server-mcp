#!/usr/bin/env node

/**
 * Apple Silicon Docker Troubleshooting Script
 * Helps diagnose and fix common SQL Server Docker issues on Apple Silicon
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('🍎 Apple Silicon SQL Server Docker Troubleshooting\n');

// Check system architecture
console.log('1. System Information:');
console.log(`   Platform: ${process.platform}`);
console.log(`   Architecture: ${process.arch}`);
console.log(`   Node.js: ${process.version}`);

// Check Docker
console.log('\n2. Docker Status:');
try {
  const dockerVersion = execSync('docker --version', { encoding: 'utf8' }).trim();
  console.log(`   ✅ Docker: ${dockerVersion}`);

  const dockerInfo = execSync('docker info --format "{{.Architecture}}"', {
    encoding: 'utf8'
  }).trim();
  console.log(`   ✅ Docker Architecture: ${dockerInfo}`);

  // Test AMD64 emulation (Rosetta 2)
  try {
    execSync('docker run --rm --platform linux/amd64 hello-world', { stdio: 'ignore' });
    console.log('   ✅ AMD64 Emulation: Working (Rosetta 2 enabled)');
  } catch {
    console.log('   ❌ AMD64 Emulation: Failed (Rosetta 2 may be disabled)');
    console.log('      💡 Fix: Enable Rosetta 2 emulation in Docker Desktop settings');
  }
} catch {
  console.log('   ❌ Docker: Not available or not running');
  console.log('      💡 Fix: Install and start Docker Desktop for Mac');
}

// Check container status
console.log('\n3. SQL Server Container Status:');
try {
  const containerStatus = execSync(
    'docker ps --filter name=warp-mcp-sqlserver --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
    { encoding: 'utf8' }
  );
  if (containerStatus.includes('warp-mcp-sqlserver')) {
    console.log('   ✅ Container is running:');
    console.log(`${containerStatus}`);
  } else {
    console.log('   ⚠️  Container not running');
  }
} catch {
  console.log('   ❌ Could not check container status');
}

// Check for recent container logs
console.log('\n4. Recent Container Logs:');
try {
  const logs = execSync('docker logs --tail 10 warp-mcp-sqlserver 2>&1', { encoding: 'utf8' });
  console.log('   📋 Last 10 log entries:');
  console.log(
    logs
      .split('\n')
      .map(line => `      ${line}`)
      .join('\n')
  );
} catch {
  console.log('   ⚠️  No logs available (container may not exist)');
}

// Check platform configuration
console.log('\n5. Platform Configuration:');
const configPath = path.join(process.cwd(), 'test/docker/.platform-config.json');
if (fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('   ✅ Platform configuration found:');
    console.log(`      Image: ${config.selected?.config?.image}`);
    console.log(`      Platform: ${config.selected?.config?.platform || 'native'}`);
    console.log(`      Performance: ${config.selected?.performance}`);
  } catch {
    console.log('   ⚠️  Platform configuration file corrupted');
  }
} else {
  console.log('   ⚠️  No platform configuration found');
  console.log('      💡 Fix: Run "npm run docker:detect" to generate optimal configuration');
}

// Recommendations
console.log('\n6. Troubleshooting Recommendations:');

if (process.arch === 'arm64' && process.platform === 'darwin') {
  console.log('   🍎 Apple Silicon Detected - Recommended fixes:');
  console.log('');
  console.log('   1. Clean restart: npm run docker:clean && npm run docker:start:init');
  console.log(
    '   2. Check Rosetta 2: Enable "Use Rosetta for x86/amd64 emulation" in Docker Desktop'
  );
  console.log('   3. Memory allocation: Increase Docker memory to at least 4GB');
  console.log('   4. Platform regeneration: npm run docker:detect (regenerates optimal config)');
  console.log('   5. Extended wait: Use longer timeouts with npm run docker:wait');
  console.log('');
  console.log('   📖 Common Apple Silicon Issues:');
  console.log('      • Container exits immediately → Check Rosetta 2 settings');
  console.log('      • "No such file or directory" → Run clean restart');
  console.log('      • Connection refused → Wait longer, SQL Server needs more time on ARM64');
  console.log('      • Permission errors → Ensure Docker has proper file system access');
} else {
  console.log('   💻 Intel/AMD64 System - Standard troubleshooting:');
  console.log('');
  console.log('   1. Clean restart: npm run docker:clean && npm run docker:start:init');
  console.log('   2. Check logs: npm run docker:logs');
  console.log('   3. Test connection: npm run docker:test-connection');
}

console.log('\n🔧 Quick Commands:');
console.log('   npm run docker:status       # Check container status');
console.log('   npm run docker:logs         # View container logs');
console.log('   npm run docker:clean        # Clean reset (removes all data)');
console.log('   npm run docker:restart      # Restart container (keeps data)');
console.log('   npm run docker:test:clean      # Full clean test run');

console.log('\n✅ Troubleshooting complete!');
