/**
 * Shared utilities for integration test configuration validation
 */

/**
 * Validate and display server security configuration for phase tests
 * @param {Object} serverConfig - The server configuration object
 * @param {Object} expectedConfig - Expected configuration values
 * @param {string} testPhase - The test phase name (for error messages)
 */
function validateServerConfiguration(serverConfig, expectedConfig, testPhase) {
  const securityConfig = serverConfig.getSecurityConfig();

  console.log('\n🔍 Server Configuration Loaded:');
  console.log('   readOnlyMode:', securityConfig.readOnlyMode);
  console.log('   allowDestructiveOperations:', securityConfig.allowDestructiveOperations);
  console.log('   allowSchemaChanges:', securityConfig.allowSchemaChanges);
  console.log('');

  // Validate read-only mode
  if (securityConfig.readOnlyMode !== expectedConfig.readOnlyMode) {
    console.error(
      `❌ CRITICAL: Read-only mode mismatch! Expected: ${expectedConfig.readOnlyMode}, Got:`,
      securityConfig.readOnlyMode
    );
    console.error(`❌ This will cause all ${testPhase} tests to fail.`);
    process.exit(1);
  }

  // Validate destructive operations
  if (securityConfig.allowDestructiveOperations !== expectedConfig.allowDestructiveOperations) {
    console.error(
      `❌ CRITICAL: Destructive operations mismatch! Expected: ${expectedConfig.allowDestructiveOperations}, Got:`,
      securityConfig.allowDestructiveOperations
    );
    console.error(`❌ This will cause all ${testPhase} tests to fail.`);
    process.exit(1);
  }

  // Validate schema changes (only check if expected config specifies it)
  if (
    expectedConfig.allowSchemaChanges !== undefined &&
    securityConfig.allowSchemaChanges !== expectedConfig.allowSchemaChanges
  ) {
    console.error(
      `❌ CRITICAL: Schema changes mismatch! Expected: ${expectedConfig.allowSchemaChanges}, Got:`,
      securityConfig.allowSchemaChanges
    );
    console.error(`❌ This will cause all ${testPhase} tests to fail.`);
    process.exit(1);
  }

  return securityConfig;
}

export { validateServerConfiguration };
