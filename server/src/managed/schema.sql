-- Hanzi Managed Platform Schema
-- Run once against Neon Postgres to initialize

-- Better Auth tables (user, session, account, verification)
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  image TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope TEXT,
  password TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hanzi tables

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stripe_customer_id TEXT,                -- Stripe customer ID (set after first checkout)
  plan TEXT NOT NULL DEFAULT 'free',      -- 'free' | 'pro' | 'enterprise'
  subscription_id TEXT,                   -- Stripe subscription ID
  subscription_status TEXT                -- 'active' | 'past_due' | 'cancelled' | null
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,        -- hashed, never store plaintext
  key_prefix TEXT NOT NULL,             -- first 20 chars for display (e.g., "hic_live_1af0b2c3d4e5")
  name TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pairing_tokens (
  token_hash TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  created_by TEXT NOT NULL,               -- API key ID or Better Auth user ID (no FK — can be either)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed BOOLEAN NOT NULL DEFAULT false,
  label TEXT,                             -- partner-supplied human-readable label
  external_user_id TEXT                   -- partner's own user identifier
);

CREATE TABLE IF NOT EXISTS browser_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  session_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT false,
  tab_id INTEGER,
  window_id INTEGER,
  label TEXT,                             -- inherited from pairing token
  external_user_id TEXT                   -- inherited from pairing token
);

CREATE TABLE IF NOT EXISTS task_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  api_key_id TEXT NOT NULL,              -- API key ID or Better Auth user ID
  browser_session_id UUID REFERENCES browser_sessions(id) ON DELETE SET NULL,
  task TEXT NOT NULL,
  url TEXT,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete', 'error', 'cancelled')),
  answer TEXT,
  steps INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  api_calls INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS task_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_run_id UUID NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  status TEXT NOT NULL,                    -- 'thinking' | 'tool_use' | 'tool_result' | 'complete' | 'error'
  tool_name TEXT,
  tool_input JSONB,
  output TEXT,                             -- tool result text or final answer
  screenshot TEXT,                         -- base64 screenshot (if captured)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER                      -- time taken for this step
);

CREATE INDEX IF NOT EXISTS idx_task_steps_task ON task_steps(task_run_id, step);

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  api_key_id TEXT NOT NULL,              -- API key ID or Better Auth user ID
  task_run_id UUID NOT NULL REFERENCES task_runs(id),
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  api_calls INTEGER NOT NULL,
  model TEXT NOT NULL,
  cost_usd NUMERIC(10, 6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workspace membership (links Better Auth users to Hanzi workspaces)
CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

-- Migration: add session metadata columns (safe to re-run)
ALTER TABLE pairing_tokens ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE pairing_tokens ADD COLUMN IF NOT EXISTS external_user_id TEXT;
ALTER TABLE browser_sessions ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE browser_sessions ADD COLUMN IF NOT EXISTS external_user_id TEXT;

-- Migration: drop FK on pairing_tokens.created_by so it can hold user IDs too
-- The constraint name varies by DB; drop by scanning pg_constraint if it exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'pairing_tokens' AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%created_by%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE pairing_tokens DROP CONSTRAINT ' || constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'pairing_tokens' AND constraint_type = 'FOREIGN KEY'
        AND constraint_name LIKE '%created_by%'
      LIMIT 1
    );
  END IF;
END $$;
ALTER TABLE pairing_tokens ALTER COLUMN created_by TYPE TEXT;

-- Migration: add billing columns to workspaces (safe to re-run)
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS subscription_id TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS subscription_status TEXT;

-- Migration: change api_key_id columns to TEXT (supports Better Auth user IDs)
ALTER TABLE task_runs ALTER COLUMN api_key_id TYPE TEXT;
ALTER TABLE usage_events ALTER COLUMN api_key_id TYPE TEXT;

-- Migration: credit system for pay-per-task billing
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS credit_balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS free_tasks_this_month INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS free_tasks_reset_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_task_runs_workspace ON task_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_usage_events_workspace ON usage_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_workspace ON browser_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

-- ─── Scheduled Automations ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  browser_session_id UUID REFERENCES browser_sessions(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'x-marketer',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  config JSONB NOT NULL DEFAULT '{}',
  -- config: { keywords, product_name, product_url, product_description,
  --           voice_profile, max_drafts, reply_mix, schedule_cron, timezone,
  --           notification_email }
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_workspace ON automations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_automations_next_run ON automations(next_run_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS automation_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  scout_task_id UUID REFERENCES task_runs(id) ON DELETE SET NULL,
  batch_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'edited', 'skipped', 'posted', 'failed')),
  -- Tweet data
  tweet_url TEXT NOT NULL,
  tweet_text TEXT,
  tweet_author_handle TEXT,
  tweet_author_name TEXT,
  tweet_author_bio TEXT,
  tweet_author_followers INTEGER,
  tweet_engagement JSONB,
  tweet_age_hours NUMERIC,
  -- Draft reply
  reply_text TEXT NOT NULL,
  reply_type TEXT CHECK (reply_type IN ('A', 'B', 'C')),
  reply_reasoning TEXT,
  score INTEGER,
  -- Post results
  post_task_id UUID REFERENCES task_runs(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ,
  edited_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drafts_automation ON automation_drafts(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_batch ON automation_drafts(batch_id);
CREATE INDEX IF NOT EXISTS idx_drafts_pending ON automation_drafts(workspace_id, status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS engagement_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  automation_id UUID REFERENCES automations(id) ON DELETE SET NULL,
  draft_id UUID REFERENCES automation_drafts(id) ON DELETE SET NULL,
  author_handle TEXT NOT NULL,
  reply_type TEXT,
  keyword TEXT,
  tweet_url TEXT,
  tweet_summary TEXT,
  reply_summary TEXT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_workspace ON engagement_log(workspace_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_handle ON engagement_log(workspace_id, author_handle);
