# Database schema

See db/migrations/001_init.sql (and docs/db-schema.sql, the same schema). All money is NUMERIC(20,8). All primary keys are UUID. Append-only tables: setup_transitions, order_events, audit_logs. Protection: audit_logs and order_events should be granted INSERT and SELECT only to the application role (grant step to be added at deployment).
