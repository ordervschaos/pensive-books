-- Move the thread-scan "notify me when done" trigger from INSERT to the terminal UPDATE.
--
-- scan-threads used to INSERT its row already-complete (status 'pending_review'), so the notify
-- trigger fired on INSERT (migration 20260603160000). Now scan-threads inserts the row 'running'
-- FIRST and flips it to 'pending_review'/'error' in the background (so it survives a refresh) — an
-- INSERT-time email would fire before the scan finished. Re-point the trigger at the transition
-- INTO a terminal state, exactly like the evaluation/revision triggers.

DROP TRIGGER IF EXISTS trg_notify_scan_done ON public.book_thread_scans;
CREATE TRIGGER trg_notify_scan_done
AFTER UPDATE ON public.book_thread_scans
FOR EACH ROW
WHEN (
  new.notify_email
  AND new.status IN ('pending_review', 'error')
  AND old.status IS DISTINCT FROM new.status
  AND old.status NOT IN ('pending_review', 'error')
)
EXECUTE FUNCTION public.notify_task_done();
