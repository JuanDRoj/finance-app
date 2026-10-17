-- Base de datos separada para los tests del backend (PostgreSQL real, nunca SQLite).
-- Solo corre la primera vez que arranca el volumen vacio (volumen <proyecto>_finance_pgdata, por defecto finance-app_finance_pgdata).
-- Si el volumen ya existe: docker compose exec postgres createdb -U <POSTGRES_USER> finance_test
CREATE DATABASE finance_test;
