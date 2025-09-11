# Wait for SQL Server to come up and be ready
for i in {1..60}
do
    echo "⏳ Waiting for SQL Server ($i/60)..."
    if /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "WarpMCP123!" -Q "SELECT 1" &>/dev/null
    then
        echo "✅ SQL Server is ready"
        echo "⏳ Running initialization script..."

        # Run the init script to create our databases and tables
        /opt/mssql-tools18/bin/sqlcmd -S localhost \
            -U sa \
            -P "WarpMCP123!" \
            -i /docker-entrypoint-initdb.d/init-db.sql

        echo "✅ Database initialization complete"
        exit 0
    fi
    sleep 1
done

echo "❌ Failed to initialize database after 60 seconds"
exit 1
