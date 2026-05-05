-- Migration 004: Auth support
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
