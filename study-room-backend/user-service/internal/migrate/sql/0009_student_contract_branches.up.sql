-- Source rows for automatic student -> branch membership. One row per active contract.
CREATE TABLE student_contract_branches (
    contract_id INTEGER PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_student_contract_branches_student_branch ON student_contract_branches(student_id, branch_id);
