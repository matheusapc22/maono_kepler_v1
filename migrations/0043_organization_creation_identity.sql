-- Additive. Run the Unicode name/suffix preflight before authorizing this file.
-- Existing display names, identifiers and storage paths are never rewritten.
-- NULL keys belong to untouched historical rows; lifecycle checks those names
-- with the same Unicode rule before every write. All name writers set the key.
ALTER TABLE organizations ADD COLUMN canonical_name TEXT;
CREATE UNIQUE INDEX idx_organization_canonical_name ON organizations(canonical_name)
 WHERE canonical_name IS NOT NULL;
-- Fail rather than repair historical numeric collisions, including other bases.
CREATE UNIQUE INDEX idx_organization_numeric_suffix ON organizations(substr(slug,-9))
 WHERE length(slug)>10 AND substr(slug,-10,1)='-'
 AND substr(slug,-9) NOT GLOB '*[^0-9]*';
CREATE TABLE organization_creation_identities (
 operation_id TEXT PRIMARY KEY REFERENCES organization_management_operations(id) ON DELETE RESTRICT,
 suffix TEXT NOT NULL UNIQUE CHECK(length(suffix)=9 AND suffix NOT GLOB '*[^0-9]*'),
 slug TEXT NOT NULL UNIQUE CHECK(length(slug)<=64),
 path TEXT NOT NULL COLLATE NOCASE UNIQUE
);
CREATE TRIGGER org_identity_reservation BEFORE INSERT ON organization_creation_identities
WHEN EXISTS(SELECT 1 FROM organizations WHERE slug=NEW.slug
 OR lower(dropbox_root_path)=lower(NEW.path)
 OR (length(slug)>10 AND substr(slug,-10,1)='-' AND substr(slug,-9)=NEW.suffix))
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_IDENTITY_COLLISION'); END;
CREATE TRIGGER org_identity_insert BEFORE INSERT ON organizations
WHEN EXISTS(SELECT 1 FROM organization_creation_identities i
 WHERE (i.slug=NEW.slug OR lower(i.path)=lower(NEW.dropbox_root_path)
 OR (length(NEW.slug)>10 AND substr(NEW.slug,-10,1)='-' AND i.suffix=substr(NEW.slug,-9)))
 AND NEW.management_create_key IS NOT i.operation_id||':0')
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_IDENTITY_COLLISION'); END;
CREATE TRIGGER org_identity_update BEFORE UPDATE OF slug,dropbox_root_path ON organizations
WHEN EXISTS(SELECT 1 FROM organization_creation_identities i
 WHERE (i.slug=NEW.slug OR lower(i.path)=lower(NEW.dropbox_root_path)
 OR (length(NEW.slug)>10 AND substr(NEW.slug,-10,1)='-' AND i.suffix=substr(NEW.slug,-9)))
 AND NEW.management_create_key IS NOT i.operation_id||':0')
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_IDENTITY_COLLISION'); END;
