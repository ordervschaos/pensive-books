-- Add created_at_minute as a regular column
ALTER TABLE page_history
ADD COLUMN created_at_minute TIMESTAMP;

-- Create a function to set created_at_minute
CREATE OR REPLACE FUNCTION set_created_at_minute()
RETURNS TRIGGER AS $$
BEGIN
  NEW.created_at_minute := date_trunc('minute', NEW.created_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to automatically set created_at_minute
CREATE TRIGGER set_created_at_minute_trigger
BEFORE INSERT OR UPDATE ON page_history
FOR EACH ROW
EXECUTE FUNCTION set_created_at_minute();

-- Create an index on page_id and created_at_minute
CREATE INDEX idx_page_history_page_id_created_at_minute 
ON page_history (page_id, created_at_minute);

-- Add a unique constraint to prevent multiple versions within the same minute
ALTER TABLE page_history
ADD CONSTRAINT unique_page_version_per_minute 
UNIQUE (page_id, created_at_minute);

-- Update existing rows to set created_at_minute
UPDATE page_history
SET created_at_minute = date_trunc('minute', created_at);
