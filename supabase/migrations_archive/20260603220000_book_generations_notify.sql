-- "Notify me when done" for book_generations tasks (the write-all cascade is the long one that
-- wants it). Mirrors the eval/revision/scan triggers (20260603160000 / 20260603200000): fire the
-- shared notify_task_done() on the transition INTO a terminal state, for opted-in rows only.
--
-- Terminal states differ by kind: a cascade ends at 'done'; a proposal (scaffold/bible/page) ends
-- at 'ready'. Both — plus 'error' — are terminal here. Only rows with notify_email set fire, and
-- today only WriteAllPages exposes that opt-in, so proposal flows stay silent by default.

DROP TRIGGER IF EXISTS trg_notify_generation_done ON public.book_generations;
CREATE TRIGGER trg_notify_generation_done
AFTER UPDATE ON public.book_generations
FOR EACH ROW
WHEN (
  new.notify_email
  AND new.status IN ('ready', 'done', 'error')
  AND old.status IS DISTINCT FROM new.status
  AND old.status NOT IN ('ready', 'done', 'error')
)
EXECUTE FUNCTION public.notify_task_done();
