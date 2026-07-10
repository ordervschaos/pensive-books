-- Fix: page_versions title and content should be nullable
-- Pages can have null titles (untitled pages), so snapshots must allow null too

ALTER TABLE page_versions ALTER COLUMN title DROP NOT NULL;
ALTER TABLE page_versions ALTER COLUMN content DROP NOT NULL;
