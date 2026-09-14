-- Test database. Runs when the Postgres container is first created
-- (docker-entrypoint-initdb.d only executes on an empty data directory).
-- To create it by hand on an existing setup:
--   docker exec servistakip-postgres-1 psql -U postgres -c "CREATE DATABASE servis_takip_test"
CREATE DATABASE servis_takip_test;
