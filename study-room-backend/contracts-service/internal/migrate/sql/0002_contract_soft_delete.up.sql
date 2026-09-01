-- Keep deleted contracts for audit/statistics instead of physically removing them.
ALTER TABLE contracts
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN deleted_by INTEGER;

CREATE INDEX idx_contracts_deleted_at ON contracts(deleted_at);
