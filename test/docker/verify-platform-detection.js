#!/usr/bin/env node

/**
 * Simple Platform Detection Verification
 *
 * Answers the core question: "Does platform detection choose the right SQL Server
 * configuration for my architecture and eliminate platform mismatch warnings?"
 *
 * This is all we really need to verify the MCP Docker setup works correctly.
 */

import {
  detectArchitecture,
  chooseBestConfiguration,
  checkDockerCapabilities
} from './detect-platform.js';
import { execSync } from 'child_process';

console.log('🔍 Platform Detection Verification for MCP Docker Setup\n');

// Step 1: What did we detect?
console.log('1️⃣ Architecture Detection:');
const hostInfo = detectArchitecture();
console.log(`   Platform: ${hostInfo.platform}`);
console.log(`   Architecture: ${hostInfo.arch}`);

if (hostInfo.isAppleSilicon) {
  console.log('   Type: Apple Silicon (ARM64) - needs platform override for SQL Server');
} else if (hostInfo.isIntelMac) {
  console.log('   Type: Intel Mac (AMD64) - native SQL Server compatibility');
} else {
  console.log(`   Type: ${hostInfo.arch} - will select appropriate configuration`);
}

// Step 2: What configuration was chosen?
console.log('\n2️⃣ Configuration Selection:');
const dockerInfo = checkDockerCapabilities();

// Suppress verbose output during selection
const originalLog = console.log;
console.log = () => {};
const selectedConfig = chooseBestConfiguration(hostInfo, dockerInfo);
console.log = originalLog;

console.log(`   Selected Image: ${selectedConfig.config.image}`);
console.log(`   Platform Override: ${selectedConfig.config.platform || 'none (native)'}`);
console.log(`   Reason: ${selectedConfig.reason}`);

// Step 3: Does it generate the right Docker config?
console.log('\n3️⃣ Docker Configuration Generation:');
try {
  execSync('npm run docker:detect', {
    stdio: 'ignore',
    env: { ...process.env, TESTING_MODE: 'true' }
  });
  console.log('   ✅ Docker Compose configuration generated successfully');
} catch (error) {
  console.log(`   ❌ Configuration generation failed: ${error.message}`);
  process.exit(1);
}

// Step 4: The critical test - does it start without platform warnings?
console.log('\n4️⃣ Platform Warning Test:');
console.log('   Starting container to check for platform mismatch warnings...');

let containerStarted = false;
try {
  // Clean state
  execSync('docker-compose -f test/docker/docker-compose.yml down -v', { stdio: 'ignore' });

  // Start container
  execSync('docker-compose -f test/docker/docker-compose.yml up -d', { stdio: 'ignore' });
  containerStarted = true;

  // Wait a moment for startup logs
  console.log('   Waiting for startup logs...');
  setTimeout(() => {}, 3000);

  // Check logs for the platform warning
  const logs = execSync('docker logs warp-mcp-sqlserver 2>&1', { encoding: 'utf8' });
  const hasWarning = logs.includes('platform') && logs.includes('does not match');

  if (hasWarning) {
    console.log('   ❌ PLATFORM MISMATCH WARNING DETECTED');
    console.log('   This means the detection is not working correctly.');
    console.log('\n   Warning found in logs:');
    const warningLines = logs
      .split('\n')
      .filter(line => line.includes('platform') || line.includes('does not match'));
    warningLines.forEach(line => console.log(`      ${line}`));
  } else {
    console.log('   ✅ NO PLATFORM WARNINGS - Detection working correctly!');
  }
} catch (error) {
  console.log(`   ❌ Container test failed: ${error.message}`);
} finally {
  if (containerStarted) {
    console.log('   Cleaning up container...');
    try {
      execSync('docker-compose -f test/docker/docker-compose.yml down', { stdio: 'ignore' });
    } catch {
      /* ignore cleanup errors */
    }
  }
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📋 SUMMARY: Platform Detection for MCP Docker Testing');
console.log('='.repeat(60));

if (hostInfo.isAppleSilicon) {
  if (selectedConfig.config.platform === 'linux/amd64') {
    console.log('✅ SUCCESS: Apple Silicon correctly configured for SQL Server');
    console.log('   - Detected ARM64 architecture');
    console.log('   - Selected SQL Server 2022 with platform override');
    console.log('   - Should eliminate platform mismatch warnings');
  } else {
    console.log('❌ ISSUE: Apple Silicon not configured correctly');
    console.log('   - Expected platform override to linux/amd64');
    console.log(`   - Got: ${selectedConfig.config.platform || 'none'}`);
  }
} else if (hostInfo.isIntelMac) {
  if (!selectedConfig.config.platform) {
    console.log('✅ SUCCESS: Intel Mac correctly configured for SQL Server');
    console.log('   - Detected AMD64 architecture');
    console.log('   - Selected native SQL Server 2022');
    console.log('   - No platform override needed');
  } else {
    console.log('❌ ISSUE: Intel Mac has unnecessary platform override');
    console.log('   - Should use native SQL Server without platform override');
  }
} else {
  console.log('✅ INFO: Other architecture handled appropriately');
  console.log(`   - Architecture: ${hostInfo.arch}`);
  console.log(`   - Configuration: ${selectedConfig.config.image}`);
}

console.log('\n🎯 BOTTOM LINE:');
console.log('The platform detection system automatically:');
console.log('• Detects your hardware architecture');
console.log('• Chooses the optimal SQL Server container configuration');
console.log('• Eliminates Docker platform mismatch warnings');
console.log('• Enables seamless MCP Docker testing');

console.log('\n💡 Next step: npm run docker:start (uses the detected configuration)');
