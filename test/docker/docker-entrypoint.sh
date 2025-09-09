#!/bin/bash
set -e

# Start SQL Server in the background
/opt/mssql/bin/sqlservr &
pid=$!

# Wait for SQL Server to start
echo "Waiting for SQL Server to be ready..."
for i in {1..60}; do
    if /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P "$SA_PASSWORD" -Q "SELECT 1" &> /dev/null; then
        echo "SQL Server is ready"
        break
    fi
    echo "Waiting... ($i/60)"
    sleep 1
done

if [ "$i" = "60" ]; then
    echo "SQL Server failed to start within 60 seconds"
    exit 1
fi

# Run initialization script
echo "Running initialization script..."
/opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P "$SA_PASSWORD" -i /docker-initdb/init-db.sql

# Keep container running by waiting for SQL Server process
wait $pid
