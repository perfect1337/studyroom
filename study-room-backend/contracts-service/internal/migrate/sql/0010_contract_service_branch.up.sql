-- 0010_contract_service_branch.up.sql
-- "Филиал обучения" — если ребёнок будет заниматься по этому договору в
-- ДРУГОМ филиале, а не в том, что административно выдал и ведёт договор
-- (branch_id). NULL означает "тот же, что и branch_id" (обычный случай).
-- Именно service_branch_id (если задан), а не branch_id, становится
-- branch_id создаваемого в Academic Service enrollment (см.
-- ContractHandler.Create) — это определяет, чей branch_owner получает
-- право назначать занятия этому ученику по этому курсу.
ALTER TABLE contracts ADD COLUMN service_branch_id INTEGER;
CREATE INDEX idx_contracts_service_branch_id ON contracts(service_branch_id);
