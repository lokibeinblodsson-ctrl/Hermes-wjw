-- Wild Jazmine Wellness — migration 0002: extend the card model.
-- Adds working-content and metadata fields to cards. All new columns are
-- nullable / defaulted so existing rows backfill automatically (SQLite ADD
-- COLUMN applies the default to existing rows).

ALTER TABLE cards ADD COLUMN draft          TEXT;              -- working content draft
ALTER TABLE cards ADD COLUMN checklist      TEXT NOT NULL DEFAULT '[]';   -- JSON: [{id,text,done}]
ALTER TABLE cards ADD COLUMN media          TEXT NOT NULL DEFAULT '[]';   -- JSON: [{id,url,type,name}]
ALTER TABLE cards ADD COLUMN resources      TEXT NOT NULL DEFAULT '[]';   -- JSON: [{id,label,url,notes}]
ALTER TABLE cards ADD COLUMN custom_fields  TEXT NOT NULL DEFAULT '[]';   -- JSON: [{id,label,value}]
ALTER TABLE cards ADD COLUMN notes          TEXT;              -- freeform notes (separate from draft)
ALTER TABLE cards ADD COLUMN content_pillar TEXT;              -- content pillar label
ALTER TABLE cards ADD COLUMN platform_ready INTEGER NOT NULL DEFAULT 0;   -- 0/1 flag
ALTER TABLE cards ADD COLUMN platforms      TEXT NOT NULL DEFAULT '[]';   -- JSON: target platform labels
ALTER TABLE cards ADD COLUMN research_page_id TEXT;           -- optional link to a research page
