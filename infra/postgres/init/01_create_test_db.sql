-- Base de datos separada para los tests del backend (PostgreSQL real, nunca SQLite).
-- Solo corre la primera vez que arranca el volumen vacio (finance_pgdata).
-- Si el volumen ya existe: docker compose exec postgres createdb -U <POSTGRES_USER> finance_test
CREATE DATABASE finance_test;
