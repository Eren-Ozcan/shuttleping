-- Test veritabanı. Postgres container'ı ilk kez oluşturulurken çalışır
-- (docker-entrypoint-initdb.d yalnızca boş bir veri dizininde işletilir).
-- Mevcut bir kurulumda elle oluşturmak için:
--   docker exec servistakip-postgres-1 psql -U postgres -c "CREATE DATABASE servis_takip_test"
CREATE DATABASE servis_takip_test;
