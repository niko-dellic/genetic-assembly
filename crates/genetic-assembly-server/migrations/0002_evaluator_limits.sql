ALTER TABLE evaluator_revisions
ADD COLUMN limits JSONB NOT NULL DEFAULT '{"memory_bytes":16777216,"stack_bytes":524288,"timeout_ms":250}'::jsonb;
