-- CC14: additive knowledge lifecycle. Apply only through the protected operator.
CREATE TABLE ticket_knowledge_articles (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id),
 created_by INTEGER NOT NULL REFERENCES users(id), reviewer_id INTEGER NOT NULL REFERENCES users(id),
 version INTEGER NOT NULL DEFAULT 1, candidate_id TEXT NOT NULL, published_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('draft','review','approved','published','withdrawn')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(organization_id,id), CHECK(created_by<>reviewer_id), CHECK(version>0)
);
CREATE TABLE ticket_knowledge_revisions (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL, article_id TEXT NOT NULL,
 number INTEGER NOT NULL CHECK(number>0), author_id INTEGER NOT NULL REFERENCES users(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 12000),
 audience TEXT NOT NULL CHECK(audience IN ('private','organization')),
 content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(organization_id,article_id,id), UNIQUE(article_id,number),
 FOREIGN KEY(organization_id,article_id) REFERENCES ticket_knowledge_articles(organization_id,id)
);
CREATE TABLE ticket_knowledge_sources (
 organization_id INTEGER NOT NULL, article_id TEXT NOT NULL,
 ticket_id INTEGER REFERENCES organization_tickets(id), case_id TEXT,
 CHECK((ticket_id IS NOT NULL)+(case_id IS NOT NULL)=1),
 PRIMARY KEY(organization_id,article_id),
 FOREIGN KEY(organization_id,article_id) REFERENCES ticket_knowledge_articles(organization_id,id),
 FOREIGN KEY(organization_id,case_id) REFERENCES ticket_cases(organization_id,id)
);
CREATE TRIGGER ticket_knowledge_source_tenant BEFORE INSERT ON ticket_knowledge_sources
WHEN NEW.ticket_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_tickets WHERE organization_id=NEW.organization_id AND id=NEW.ticket_id)
BEGIN SELECT RAISE(ABORT,'CC14_TENANT'); END;
CREATE TABLE ticket_knowledge_commands (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id), actor_id INTEGER NOT NULL REFERENCES users(id),
 request_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL
);
CREATE TABLE ticket_knowledge_events (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL, article_id TEXT NOT NULL, revision_id TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(organization_id,article_id,revision_id) REFERENCES ticket_knowledge_revisions(organization_id,article_id,id)
);
CREATE TABLE ticket_knowledge_uses (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL, article_id TEXT NOT NULL, revision_id TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES users(id), ticket_id INTEGER NOT NULL REFERENCES organization_tickets(id),
 kind TEXT NOT NULL CHECK(kind IN ('response','internal')), created_at TEXT NOT NULL,
 message_id TEXT UNIQUE REFERENCES ticket_messages(id), reviewed_at TEXT,
 FOREIGN KEY(organization_id,article_id,revision_id) REFERENCES ticket_knowledge_revisions(organization_id,article_id,id),
 CHECK((message_id IS NULL AND reviewed_at IS NULL) OR (message_id IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TRIGGER ticket_knowledge_use_tenant BEFORE INSERT ON ticket_knowledge_uses
WHEN NOT EXISTS(SELECT 1 FROM organization_tickets WHERE organization_id=NEW.organization_id AND id=NEW.ticket_id)
BEGIN SELECT RAISE(ABORT,'CC14_TENANT'); END;
CREATE TRIGGER ticket_knowledge_use_message BEFORE UPDATE ON ticket_knowledge_uses
WHEN OLD.message_id IS NOT NULL OR NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at OR NEW.organization_id<>OLD.organization_id OR NEW.article_id<>OLD.article_id
 OR NEW.revision_id<>OLD.revision_id OR NEW.actor_id<>OLD.actor_id OR NEW.ticket_id<>OLD.ticket_id OR NEW.kind<>OLD.kind
 OR NOT EXISTS(SELECT 1 FROM ticket_messages WHERE id=NEW.message_id AND organization_id=NEW.organization_id AND ticket_id=NEW.ticket_id AND author_user_id=NEW.actor_id)
BEGIN SELECT RAISE(ABORT,'CC14_IMMUTABLE'); END;
CREATE TABLE ticket_knowledge_guard(value INTEGER NOT NULL CHECK(value=1));
CREATE INDEX ticket_knowledge_org ON ticket_knowledge_articles(organization_id,id);
CREATE INDEX ticket_knowledge_history ON ticket_knowledge_events(organization_id,article_id,created_at,id);
CREATE INDEX ticket_knowledge_message ON ticket_knowledge_uses(organization_id,ticket_id,message_id);
CREATE TRIGGER ticket_knowledge_revisions_update_immutable BEFORE UPDATE ON ticket_knowledge_revisions BEGIN SELECT RAISE(ABORT,'CC14_IMMUTABLE'); END;
CREATE TRIGGER ticket_knowledge_revisions_delete_immutable BEFORE DELETE ON ticket_knowledge_revisions BEGIN SELECT RAISE(ABORT,'CC14_IMMUTABLE'); END;
CREATE TRIGGER ticket_knowledge_events_update_immutable BEFORE UPDATE ON ticket_knowledge_events BEGIN SELECT RAISE(ABORT,'CC14_IMMUTABLE'); END;
CREATE TRIGGER ticket_knowledge_events_delete_immutable BEFORE DELETE ON ticket_knowledge_events BEGIN SELECT RAISE(ABORT,'CC14_IMMUTABLE'); END;
CREATE TRIGGER ticket_knowledge_sources_update_immutable BEFORE UPDATE ON ticket_knowledge_sources BEGIN SELECT RAISE(ABORT,'CC14_IMMUTABLE'); END;
CREATE TRIGGER ticket_knowledge_sources_delete_immutable BEFORE DELETE ON ticket_knowledge_sources BEGIN SELECT RAISE(ABORT,'CC14_IMMUTABLE'); END;
CREATE TRIGGER ticket_knowledge_epoch_ticket_knowledge_articles_insert AFTER INSERT ON ticket_knowledge_articles BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_knowledge_epoch_ticket_knowledge_articles_update AFTER UPDATE ON ticket_knowledge_articles BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_knowledge_epoch_ticket_knowledge_articles_delete AFTER DELETE ON ticket_knowledge_articles BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_knowledge_epoch_ticket_knowledge_revisions_insert AFTER INSERT ON ticket_knowledge_revisions BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_knowledge_epoch_ticket_knowledge_revisions_update AFTER UPDATE ON ticket_knowledge_revisions BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_knowledge_epoch_ticket_knowledge_revisions_delete AFTER DELETE ON ticket_knowledge_revisions BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_knowledge_epoch_ticket_knowledge_uses_insert AFTER INSERT ON ticket_knowledge_uses BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_knowledge_epoch_ticket_knowledge_uses_update AFTER UPDATE ON ticket_knowledge_uses BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_knowledge_epoch_ticket_knowledge_uses_delete AFTER DELETE ON ticket_knowledge_uses BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_knowledge_uses_no_delete BEFORE DELETE ON ticket_knowledge_uses
BEGIN SELECT RAISE(ABORT,'CC14_IMMUTABLE'); END;
CREATE TRIGGER ticket_knowledge_article_revision_scope BEFORE UPDATE ON ticket_knowledge_articles
WHEN NOT EXISTS(SELECT 1 FROM ticket_knowledge_revisions WHERE organization_id=NEW.organization_id AND article_id=NEW.id AND id=NEW.candidate_id)
 OR (NEW.published_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ticket_knowledge_revisions WHERE organization_id=NEW.organization_id AND article_id=NEW.id AND id=NEW.published_id))
BEGIN SELECT RAISE(ABORT,'CC14_TENANT'); END;
