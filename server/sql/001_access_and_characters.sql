CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wechat_openid text UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'limited', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS works (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_works_owner ON works(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  name text NOT NULL,
  character_role text NOT NULL,
  public_summary text NOT NULL DEFAULT '',
  private_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  visual_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_id, name)
);
CREATE INDEX IF NOT EXISTS idx_characters_work ON characters(work_id, sort_order);

CREATE TABLE IF NOT EXISTS character_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  source_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  target_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  public_label text NOT NULL,
  private_description text NOT NULL DEFAULT '',
  unlock_scene_id uuid,
  spoiler_level text NOT NULL DEFAULT 'none' CHECK (spoiler_level IN ('none', 'minor', 'major')),
  CHECK (source_character_id <> target_character_id),
  UNIQUE (source_character_id, target_character_id)
);

CREATE TABLE IF NOT EXISTS character_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  asset_url text NOT NULL,
  prompt text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  visual_profile_version integer NOT NULL,
  is_reference boolean NOT NULL DEFAULT false,
  moderation_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, visual_profile_version, asset_url)
);
CREATE INDEX IF NOT EXISTS idx_character_assets_reference ON character_assets(character_id, is_reference, created_at DESC);

CREATE TABLE IF NOT EXISTS character_unlocks (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  reader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unlock_level integer NOT NULL DEFAULT 0 CHECK (unlock_level BETWEEN 0 AND 100),
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, reader_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  trace_id text NOT NULL,
  ip_hash text,
  result text NOT NULL CHECK (result IN ('success', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);

INSERT INTO roles (code, name) VALUES
  ('super_admin', '超级管理员'), ('model_admin', '模型管理员'),
  ('content_reviewer', '内容审核员'), ('operator', '运营人员'),
  ('data_viewer', '数据查看员'), ('creator', '创作者'), ('user', '普通用户')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO permissions (code, name) VALUES
  ('work.read.own', '查看自己的作品'), ('work.edit.own', '编辑自己的作品'),
  ('content.review', '审核内容'), ('user.manage', '管理用户与角色'),
  ('model.manage', '管理模型供应商'), ('audit.read', '查看操作审计'),
  ('analytics.read', '查看数据报表')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;
