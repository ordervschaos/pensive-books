-- Add created_at_minute as a regular column (only if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'page_history' AND column_name = 'created_at_minute'
  ) THEN
    ALTER TABLE page_history ADD COLUMN created_at_minute TIMESTAMP;
  END IF;
END $$;

-- Create a function to set created_at_minute
CREATE OR REPLACE FUNCTION set_created_at_minute()
RETURNS TRIGGER AS $$
BEGIN
  NEW.created_at_minute := date_trunc('minute', NEW.created_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to automatically set created_at_minute (drop if exists first)
DROP TRIGGER IF EXISTS set_created_at_minute_trigger ON page_history;
CREATE TRIGGER set_created_at_minute_trigger
BEFORE INSERT OR UPDATE ON page_history
FOR EACH ROW
EXECUTE FUNCTION set_created_at_minute();

-- Create an index on page_id and created_at_minute (only if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_page_history_page_id_created_at_minute'
  ) THEN
    CREATE INDEX idx_page_history_page_id_created_at_minute
    ON page_history (page_id, created_at_minute);
  END IF;
END $$;

-- Add a unique constraint to prevent multiple versions within the same minute (only if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_page_version_per_minute'
  ) THEN
    ALTER TABLE page_history
    ADD CONSTRAINT unique_page_version_per_minute
    UNIQUE (page_id, created_at_minute);
  END IF;
END $$;

-- Update existing rows to set created_at_minute (only where it's null)
UPDATE page_history
SET created_at_minute = date_trunc('minute', created_at)
WHERE created_at_minute IS NULL;
