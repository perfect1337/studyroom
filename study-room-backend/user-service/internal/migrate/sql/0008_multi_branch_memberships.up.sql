-- Multi-branch membership for tutors and students.
CREATE TABLE user_branch_memberships (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, branch_id)
);
CREATE INDEX idx_user_branch_memberships_branch ON user_branch_memberships(branch_id, user_id);

INSERT INTO user_branch_memberships (user_id, branch_id)
SELECT id, branch_id FROM users
WHERE role IN ('student', 'tutor') AND branch_id IS NOT NULL
ON CONFLICT DO NOTHING;
