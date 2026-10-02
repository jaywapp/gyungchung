alter table public.feedback
  add column submission_source text
    constraint feedback_submission_source_valid check (submission_source in ('web', 'app'));
