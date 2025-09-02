# Index.js Refactoring Plan

## Current State

- **File size**: 2,307 lines
- **Main issues**: Monolithic class, mixed responsibilities, hard to test individual components

## Proposed New Structure

### 1. `index.js` (100-200 lines)

**Purpose**: Main entry point and orchestration

```javascript
import { SqlServerMCP } from './lib/core/sql-server-mcp.js';

// Simple startup logic
const server = new SqlServerMCP();
await server.run();
```

### 2. `lib/core/sql-server-mcp.js` (200-300 lines)

**Purpose**: Main class with orchestration logic

- Constructor and basic setup
- High-level coordination methods
- Plugin/module registration
- Main run() method

### 3. `lib/database/connection-manager.js` (150-200 lines)

**Purpose**: Database connection handling

- `connectToDatabase()` method
- Connection pooling logic
- Retry logic with exponential backoff
- Windows Authentication handling
- Connection health monitoring

### 4. `lib/database/query-executor.js` (200-300 lines)

**Purpose**: Query execution logic

- `executeQuery()` method
- Query validation integration
- Performance monitoring integration
- Error handling and retries
- Result formatting

### 5. `lib/tools/tool-registry.js` (300-400 lines)

**Purpose**: Tool definitions and registration

- All tool schema definitions
- Tool handler mapping
- Tool categorization
- Dynamic tool loading

### 6. `lib/tools/handlers/` (Multiple files ~100-150 lines each)

**Purpose**: Individual tool implementations

- `database-tools.js` - listDatabases, listTables, describeTable
- `data-tools.js` - getTableData, exportTableCsv
- `analysis-tools.js` - explainQuery, analyzeQueryPerformance
- `performance-tools.js` - getPerformanceStats, getQueryPerformance
- `optimization-tools.js` - getIndexRecommendations, detectQueryBottlenecks

### 7. `lib/config/server-config.js` (100-150 lines)

**Purpose**: Configuration management

- Environment variable handling
- Default values
- Configuration validation
- Safety settings (read-only, destructive ops, etc.)

### 8. `lib/security/query-security.js` (150-200 lines)

**Purpose**: Enhanced query validation

- Move `validateQuery()` method here
- Destructive pattern matching
- Schema change detection
- Security policy enforcement

## Benefits of This Structure

### 🎯 **Improved Maintainability**

- Each file has a single responsibility
- Easier to locate and modify specific functionality
- Reduced cognitive load when working on features

### 🧪 **Better Testability**

- Can test individual components in isolation
- Easier to mock dependencies
- More focused unit tests

### 👥 **Team Collaboration**

- Multiple developers can work on different parts
- Cleaner git diffs and merge conflicts
- Easier code reviews

### 📈 **Scalability**

- Easy to add new tools without touching core logic
- Plugin architecture for future extensions
- Better separation of concerns

### 🔧 **Development Experience**

- IDE performance improvements
- Faster file navigation
- Better IntelliSense/autocomplete

## Migration Strategy

### Phase 1: Extract Database Layer

1. Create `lib/database/connection-manager.js`
2. Move connection logic from `index.js`
3. Create `lib/database/query-executor.js`
4. Move `executeQuery()` method
5. Update imports and tests

### Phase 2: Extract Configuration

1. Create `lib/config/server-config.js`
2. Move all environment variable handling
3. Update constructor to use config class

### Phase 3: Extract Security

1. Move `validateQuery()` to `lib/security/query-security.js`
2. Enhance with additional validation logic
3. Update query executor to use new security module

### Phase 4: Extract Tools

1. Create `lib/tools/tool-registry.js`
2. Move tool definitions from `setupToolHandlers()`
3. Create individual tool handler files
4. Implement dynamic tool loading

### Phase 5: Refactor Main Class

1. Update `SqlServerMCP` to use new modules
2. Simplify constructor and methods
3. Focus on orchestration rather than implementation

## File Size Targets

- `index.js`: 50-100 lines
- `lib/core/sql-server-mcp.js`: 200-300 lines
- Individual modules: 100-200 lines each
- Tool handlers: 50-150 lines each

## Testing Strategy

- Each module should have its own test file
- Mock external dependencies at module boundaries
- Integration tests for the main class
- End-to-end tests remain unchanged
