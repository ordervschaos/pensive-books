-- Private storage for admin-only Reader Machine inspection fixtures.
--
-- The /reader demo's pre-filled run intentionally ships measurements only, not the manuscript
-- (a copyrighted reference book backs it — see apps/web/src/features/reader/fixtures/DemoFixture.tsx).
-- For admin inspection, the full-text version of the same fixture lives here instead: a PRIVATE
-- bucket, gated by admin_users membership, never bundled into the public web build.

INSERT INTO "storage"."buckets" ("id", "name", "public")
VALUES ('reader-admin', 'reader-admin', false)
ON CONFLICT ("id") DO NOTHING;

CREATE POLICY "Admins can read reader-admin fixtures"
  ON "storage"."objects" FOR SELECT
  USING (
    "bucket_id" = 'reader-admin'
    AND EXISTS (SELECT 1 FROM "public"."admin_users" "au" WHERE "au"."user_id" = "auth"."uid"())
  );
