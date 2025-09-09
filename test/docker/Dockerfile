FROM mcr.microsoft.com/mssql/server:2022-latest

USER root

# Create initialization directories with correct permissions
RUN mkdir -p /docker-entrypoint-initdb.d && \
    chown mssql:mssql /docker-entrypoint-initdb.d

# Copy initialization scripts
COPY --chown=mssql:mssql init-db.sql /docker-entrypoint-initdb.d/
COPY --chown=mssql:mssql entrypoint.sh /usr/local/bin/

# Set proper permissions for scripts
RUN chmod +x /usr/local/bin/entrypoint.sh

USER mssql

# Use our custom entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
