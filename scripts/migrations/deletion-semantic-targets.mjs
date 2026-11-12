// Diagnostic scope only, NOT an approved compatibility reference.
// Observed descriptors: sanitized audit 43124161181, product 97236515.
// These names constrain disclosure; neither their presence nor matching hashes authorizes a schema.
export const TABLE_COLUMNS = Object.freeze({
  "role_permissions": [
    "id",
    "role",
    "permission",
    "scope_type",
    "active",
    "created_at",
    "updated_at"
  ],
  "user_permissions": [
    "id",
    "user_id",
    "permission",
    "organization_id",
    "project_id",
    "active",
    "created_by",
    "created_at",
    "updated_at",
    "expires_at"
  ],
  "favorite_projects": [
    "user_id",
    "project_id",
    "created_at"
  ],
  "organization_feature_flags": [
    "id",
    "organization_id",
    "flag",
    "enabled",
    "created_at",
    "updated_at"
  ],
  "organization_limits": [
    "id",
    "organization_id",
    "key",
    "value",
    "created_at",
    "updated_at"
  ],
  "ticket_comments": [
    "id",
    "ticket_id",
    "user_id",
    "body",
    "internal",
    "created_at",
    "updated_at"
  ],
  "tickets": [
    "id",
    "organization_id",
    "project_id",
    "created_by",
    "assigned_to",
    "title",
    "description",
    "status",
    "priority",
    "created_at",
    "updated_at",
    "closed_at"
  ]
});
export const INDEX_DESCRIPTORS = Object.freeze({
  "idx_audit_logs_action": {
    "table": "audit_logs",
    "columns": [
      "action"
    ],
    "unique": false,
    "partial": false
  },
  "idx_audit_logs_project": {
    "table": "audit_logs",
    "columns": [
      "project_id"
    ],
    "unique": false,
    "partial": false
  },
  "idx_audit_logs_user": {
    "table": "audit_logs",
    "columns": [
      "user_id"
    ],
    "unique": false,
    "partial": false
  },
  "idx_favorite_projects_project_id": {
    "table": "favorite_projects",
    "columns": [
      "project_id"
    ],
    "unique": false,
    "partial": false
  },
  "idx_favorite_projects_user_id": {
    "table": "favorite_projects",
    "columns": [
      "user_id"
    ],
    "unique": false,
    "partial": false
  },
  "idx_favorite_projects_project": {
    "table": "favorite_projects",
    "columns": [
      "project_id"
    ],
    "unique": false,
    "partial": false
  },
  "idx_organization_feature_flags_org": {
    "table": "organization_feature_flags",
    "columns": [
      "organization_id",
      "enabled"
    ],
    "unique": false,
    "partial": false
  },
  "idx_organization_limits_org": {
    "table": "organization_limits",
    "columns": [
      "organization_id"
    ],
    "unique": false,
    "partial": false
  },
  "idx_role_permissions_permission": {
    "table": "role_permissions",
    "columns": [
      "permission",
      "active"
    ],
    "unique": false,
    "partial": false
  },
  "idx_role_permissions_role": {
    "table": "role_permissions",
    "columns": [
      "role",
      "active"
    ],
    "unique": false,
    "partial": false
  },
  "idx_ticket_comments_ticket": {
    "table": "ticket_comments",
    "columns": [
      "ticket_id",
      "created_at"
    ],
    "unique": false,
    "partial": false
  },
  "idx_tickets_created_by": {
    "table": "tickets",
    "columns": [
      "created_by"
    ],
    "unique": false,
    "partial": false
  },
  "idx_tickets_project": {
    "table": "tickets",
    "columns": [
      "project_id"
    ],
    "unique": false,
    "partial": false
  },
  "idx_tickets_org_status": {
    "table": "tickets",
    "columns": [
      "organization_id",
      "status"
    ],
    "unique": false,
    "partial": false
  },
  "idx_user_permissions_project_id": {
    "table": "user_permissions",
    "columns": [
      "project_id"
    ],
    "unique": false,
    "partial": false
  },
  "idx_user_permissions_organization_id": {
    "table": "user_permissions",
    "columns": [
      "organization_id"
    ],
    "unique": false,
    "partial": false
  },
  "idx_user_permissions_permission": {
    "table": "user_permissions",
    "columns": [
      "permission"
    ],
    "unique": false,
    "partial": false
  },
  "idx_user_permissions_user_id": {
    "table": "user_permissions",
    "columns": [
      "user_id"
    ],
    "unique": false,
    "partial": false
  },
  "idx_user_permissions_project": {
    "table": "user_permissions",
    "columns": [
      "project_id",
      "permission",
      "active"
    ],
    "unique": false,
    "partial": false
  },
  "idx_user_permissions_org": {
    "table": "user_permissions",
    "columns": [
      "organization_id",
      "permission",
      "active"
    ],
    "unique": false,
    "partial": false
  },
  "idx_user_permissions_lookup": {
    "table": "user_permissions",
    "columns": [
      "user_id",
      "permission",
      "active"
    ],
    "unique": false,
    "partial": false
  },
  "idx_user_permissions_unique_project": {
    "table": "user_permissions",
    "columns": [
      "user_id",
      "permission",
      "project_id"
    ],
    "unique": true,
    "partial": true
  },
  "idx_user_permissions_unique_org": {
    "table": "user_permissions",
    "columns": [
      "user_id",
      "permission",
      "organization_id"
    ],
    "unique": true,
    "partial": true
  },
  "idx_user_permissions_unique_global": {
    "table": "user_permissions",
    "columns": [
      "user_id",
      "permission"
    ],
    "unique": true,
    "partial": true
  }
});
