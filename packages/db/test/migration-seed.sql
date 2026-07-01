-- Representative populated data for the db:test-migrate upgrade gate.
--
-- Purpose: put a row on the child side of every foreign-key edge so the gate
-- exercises an FK-parent table-rebuild against populated NO ACTION dependents
-- (why that rebuild fails on the prod apply: see scripts/test-migrate.mjs). The
-- coverage guard asserts at least one non-null reference per FK edge, so leaving
-- any edge unseeded fails the gate loudly rather than letting the dangerous case
-- slip through empty-of-dependents.
--
-- Rows are inserted parents-before-children (FK-safe), modeled on the ordering
-- in apps/web/e2e/auth.ts resetInstanceState(). Ids are `mt_*` literals.

-- Users (root). u2 carries the users self-reference edges (deactivated_by / deleted_by).
INSERT INTO users (id, email, email_verified, name, created_at, updated_at, attribution_preference)
VALUES ('mt_u1', 'mt_u1@migration-test.local', 1, 'Migration Test One', 0, 0, 'preserve_name');
INSERT INTO users (id, email, email_verified, name, created_at, updated_at, attribution_preference, deactivated_at, deactivated_by, deleted_at, deleted_by)
VALUES ('mt_u2', 'mt_u2@migration-test.local', 1, 'Migration Test Two', 0, 0, 'preserve_name', 0, 'mt_u1', 0, 'mt_u1');

-- Auth-adjacent children of users.
INSERT INTO accounts (id, user_id, account_id, provider_id, created_at, updated_at)
VALUES ('mt_acc1', 'mt_u1', 'mt_acc1', 'credential', 0, 0);
INSERT INTO sessions (id, user_id, token, expires_at, created_at, updated_at)
VALUES ('mt_sess1', 'mt_u1', 'mt-token', 0, 0, 0);

-- Instance singleton (seeded NULL by migration 0002); set updated_by to cover its edge.
UPDATE instance_settings SET updated_by = 'mt_u1', updated_at = 0 WHERE id = 'instance';

INSERT INTO instance_operators (user_id, granted_at, granted_by, revoked_at, revoked_by)
VALUES ('mt_u1', 0, 'mt_u1', 0, 'mt_u2');
INSERT INTO approved_emails (email, added_by, added_at)
VALUES ('mt_u1@migration-test.local', 'mt_u1', 0);
INSERT INTO system_flags (key, value_json, set_by, set_at)
VALUES ('mt_flag', '{}', 'mt_u1', 0);

-- Groups. g1 active (the parent most children hang off); g2 archived to cover groups.archived_by.
INSERT INTO groups (id, name, admission_policy, status, created_at, updated_at)
VALUES ('mt_g1', 'MT Group', 'invite_only', 'active', 0, 0);
INSERT INTO groups (id, name, admission_policy, status, archived_at, archived_by, created_at, updated_at)
VALUES ('mt_g2', 'MT Group Archived', 'invite_only', 'archived', 0, 'mt_u1', 0, 0);

INSERT INTO group_memberships (id, group_id, user_id, role, joined_at)
VALUES ('mt_gm1', 'mt_g1', 'mt_u1', 'admin', 0);
INSERT INTO group_memberships (id, group_id, user_id, role, joined_at, removed_at, removed_by)
VALUES ('mt_gm2', 'mt_g1', 'mt_u2', 'participant', 0, 0, 'mt_u1');

-- Tracks. t1 active (parent of activities/sessions/enrollments); t2 archived covers tracks.archived_by.
INSERT INTO tracks (id, group_id, name, status, track_structure_json, contribution_policy_json, created_at, updated_at)
VALUES ('mt_t1', 'mt_g1', 'MT Track', 'active', '{}', '{}', 0, 0);
INSERT INTO tracks (id, group_id, name, status, track_structure_json, contribution_policy_json, archived_at, archived_by, created_at, updated_at)
VALUES ('mt_t2', 'mt_g1', 'MT Track Archived', 'archived', '{}', '{}', 0, 'mt_u1', 0, 0);

INSERT INTO track_enrollments (id, track_id, user_id, role, enrolled_at)
VALUES ('mt_te1', 'mt_t1', 'mt_u1', 'facilitator', 0);
INSERT INTO track_enrollments (id, track_id, user_id, role, enrolled_at, left_at, left_by)
VALUES ('mt_te2', 'mt_t1', 'mt_u2', 'participant', 0, 0, 'mt_u1');

-- One invitation row covers group_id + track_id + created_by + consumed_by + revoked_by.
INSERT INTO group_invitations (id, group_id, track_id, token, created_by, created_at, expires_at, consumed_at, consumed_by, revoked_at, revoked_by)
VALUES ('mt_gi1', 'mt_g1', 'mt_t1', 'mt-invite', 'mt_u1', 0, 0, 0, 'mt_u2', 0, 'mt_u1');

INSERT INTO pending_contributions (id, track_id, author_user_id, payload_json, status, created_at, reviewed_at, reviewed_by)
VALUES ('mt_pc1', 'mt_t1', 'mt_u1', '{}', 'approved', 0, 0, 'mt_u1');

-- Library. item covers retired_by; revision + steward cover their edges.
INSERT INTO library_items (id, group_id, title, tags_json, current_revision_id, uploaded_by, retired_at, retired_by, created_at, updated_at)
VALUES ('mt_li1', 'mt_g1', 'MT Item', '[]', 'mt_lr1', 'mt_u1', 0, 'mt_u1', 0, 0);
INSERT INTO library_revisions (id, library_item_id, revision_number, storage_key, mime_type, size_bytes, uploaded_by, uploaded_at)
VALUES ('mt_lr1', 'mt_li1', 1, 'mt/key', 'application/pdf', 1, 'mt_u1', 0);
INSERT INTO library_stewards (id, library_item_id, user_id, granted_at, granted_by)
VALUES ('mt_ls1', 'mt_li1', 'mt_u1', 0, 'mt_u1');

INSERT INTO pending_uploads (id, uploader_user_id, group_id, library_item_id, revision_id, declared_size_bytes, declared_mime_type, context, created_at, expires_at)
VALUES ('mt_pu1', 'mt_u1', 'mt_g1', 'mt_li1', 'mt_rev', 1, 'application/pdf', 'library', 0, 0);

-- Activities. la1 is the primary; la2 exists so the self-referential edge tables
-- (prerequisites / suggested-sequences) can point one activity at another.
INSERT INTO learning_activities (id, track_id, title, parts_json, flow_json, audience_json, completion_rule_json, participation_mode, created_at, updated_at)
VALUES ('mt_la1', 'mt_t1', 'MT Activity One', '[]', '{}', '{}', '{}', 'individual', 0, 0);
INSERT INTO learning_activities (id, track_id, title, parts_json, flow_json, audience_json, completion_rule_json, participation_mode, created_at, updated_at)
VALUES ('mt_la2', 'mt_t1', 'MT Activity Two', '[]', '{}', '{}', '{}', 'individual', 0, 0);

INSERT INTO activity_library_refs (id, activity_id, library_item_id, pinned_revision_id)
VALUES ('mt_alr1', 'mt_la1', 'mt_li1', 'mt_lr1');
INSERT INTO activity_prerequisites (id, activity_id, prerequisite_activity_id)
VALUES ('mt_ap1', 'mt_la1', 'mt_la2');
INSERT INTO activity_suggested_sequences (id, activity_id, next_activity_id)
VALUES ('mt_ass1', 'mt_la1', 'mt_la2');

INSERT INTO activity_records (id, activity_id, participant_id, completion_state, created_at, updated_at)
VALUES ('mt_ar1', 'mt_la1', 'mt_u1', 'in_progress', 0, 0);
INSERT INTO evidence_signals (id, activity_id, participant_id, part_id, signal_type, value_json, updated_at)
VALUES ('mt_es1', 'mt_la1', 'mt_u1', 'mt_part', 'word_count', '{}', 0);

-- part_progress / part_history are ON DELETE CASCADE children of activity_records:
-- a rebuild of activity_records would wipe these, which the cascade-wipe guard catches.
INSERT INTO part_progress (id, activity_record_id, part_id, state_json, updated_at)
VALUES ('mt_pp1', 'mt_ar1', 'mt_part', '{}', 0);
INSERT INTO part_history (id, activity_record_id, part_id, state_json, recorded_at)
VALUES ('mt_ph1', 'mt_ar1', 'mt_part', '{}', 0);

-- Sessions. session_attendance / study_session_activities are ON DELETE CASCADE children.
INSERT INTO study_sessions (id, track_id, title, scheduled_at, created_by, created_at, updated_at)
VALUES ('mt_ss1', 'mt_t1', 'MT Session', 0, 'mt_u1', 0, 0);
INSERT INTO study_session_activities (id, session_id, activity_id, display_order)
VALUES ('mt_ssa1', 'mt_ss1', 'mt_la1', 0);
INSERT INTO session_attendance (id, session_id, user_id, recorded_at, recorded_by)
VALUES ('mt_sa1', 'mt_ss1', 'mt_u1', 0, 'mt_u1');
