PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organization_roadmaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  calendar_policy TEXT NOT NULL DEFAULT 'calendar_days' CHECK (calendar_policy IN ('calendar_days', 'business_days')),
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS roadmap_phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  roadmap_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#D6A84F',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (roadmap_id) REFERENCES organization_roadmaps(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS roadmap_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  roadmap_id INTEGER NOT NULL,
  phase_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 1 CHECK (duration_days >= 0),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'review', 'completed', 'blocked', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  assignee_id INTEGER,
  is_milestone INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (roadmap_id) REFERENCES organization_roadmaps(id) ON DELETE CASCADE,
  FOREIGN KEY (phase_id) REFERENCES roadmap_phases(id) ON DELETE RESTRICT,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS roadmap_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  roadmap_id INTEGER NOT NULL,
  predecessor_task_id INTEGER NOT NULL,
  successor_task_id INTEGER NOT NULL,
  dependency_type TEXT NOT NULL DEFAULT 'finish_to_start' CHECK (dependency_type = 'finish_to_start'),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (roadmap_id, predecessor_task_id, successor_task_id),
  CHECK (predecessor_task_id <> successor_task_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (roadmap_id) REFERENCES organization_roadmaps(id) ON DELETE CASCADE,
  FOREIGN KEY (predecessor_task_id) REFERENCES roadmap_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (successor_task_id) REFERENCES roadmap_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS roadmap_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  roadmap_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  author_user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  edited_at TEXT,
  moderated_at TEXT,
  moderated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (roadmap_id) REFERENCES organization_roadmaps(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES roadmap_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS roadmap_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  roadmap_id INTEGER NOT NULL,
  task_id INTEGER,
  actor_user_id INTEGER,
  event_type TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (roadmap_id) REFERENCES organization_roadmaps(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES roadmap_tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_roadmaps_org_status ON organization_roadmaps(organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_roadmap_phases_scope ON roadmap_phases(organization_id, roadmap_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_scope ON roadmap_tasks(organization_id, roadmap_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_assignee ON roadmap_tasks(organization_id, assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_roadmap_dependencies_scope ON roadmap_dependencies(organization_id, roadmap_id, successor_task_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_comments_scope ON roadmap_comments(organization_id, roadmap_id, task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_roadmap_events_scope ON roadmap_events(organization_id, roadmap_id, created_at DESC);

INSERT OR IGNORE INTO role_permissions (role, permission, scope_type, active) VALUES
  ('admin', 'roadmap.view', 'organization', 1),
  ('admin', 'roadmap.comment.create', 'organization', 1),
  ('admin', 'roadmap.comment.edit_own', 'organization', 1),
  ('admin', 'roadmap.comment.moderate', 'organization', 1),
  ('admin', 'roadmap.manage', 'organization', 1),
  ('admin', 'roadmap.task.manage', 'organization', 1),
  ('admin', 'roadmap.dependency.manage', 'organization', 1),
  ('owner', 'roadmap.view', 'organization', 1),
  ('owner', 'roadmap.comment.create', 'organization', 1),
  ('owner', 'roadmap.comment.edit_own', 'organization', 1),
  ('owner', 'roadmap.comment.moderate', 'organization', 1),
  ('owner', 'roadmap.manage', 'organization', 1),
  ('owner', 'roadmap.task.manage', 'organization', 1),
  ('owner', 'roadmap.dependency.manage', 'organization', 1),
  ('editor', 'roadmap.view', 'organization', 1),
  ('editor', 'roadmap.comment.create', 'organization', 1),
  ('editor', 'roadmap.comment.edit_own', 'organization', 1),
  ('viewer', 'roadmap.view', 'organization', 1),
  ('viewer', 'roadmap.comment.create', 'organization', 1),
  ('viewer', 'roadmap.comment.edit_own', 'organization', 1);
