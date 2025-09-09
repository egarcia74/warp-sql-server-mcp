#!/bin/bash

# Wait for SQL Server to start
/opt/mssql/bin/sqlservr &

# Wait for SQL Server to be responsive
until /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P WarpMCP123! -C -Q 'SELECT 1;' &>/dev/null; do
  echo "Waiting for SQL Server to start..."
  sleep 2
done

echo "SQL Server is ready. Running init script..."
/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P WarpMCP123! -C -i /docker-entrypoint-initdb.d/init-db.sql -b

# Keep container running
wait $!
