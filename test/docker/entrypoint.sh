#!/bin/bash

# Start SQL Server in the background
/opt/mssql/bin/sqlservr &
SQL_PID=$!

# Wait for SQL Server to start
echo "⏳ Waiting for SQL Server to start..."
RETRY_COUNT=30
DELAY=2
COUNTER=0

until /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SA_PASSWORD" -Q "SELECT 1" &>/dev/null
do
  COUNTER=$((COUNTER + 1))
  if [ $COUNTER -gt $RETRY_COUNT ]; then
    echo "❌ Error: SQL Server failed to start within $(($RETRY_COUNT * $DELAY)) seconds."
    exit 1
  fi
  echo "🔄 Waiting... ($COUNTER/$RETRY_COUNT)"
  sleep $DELAY
done

echo "✅ SQL Server is ready"

# Run initialization script
echo "🚀 Running initialization script..."
/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SA_PASSWORD" -i /tmp/init-db.sql/init-db.sql

echo "✅ Initialization complete"

# Keep the container running with proper signal handling
trap "kill $SQL_PID" SIGTERM
wait $SQL_PID
