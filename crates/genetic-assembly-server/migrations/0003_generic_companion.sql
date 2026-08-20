CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY,
  content_hash text NOT NULL UNIQUE,
  artifact_key text NOT NULL,
  media_type text,
  byte_length bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS problem_revisions (
  id uuid PRIMARY KEY,
  content_hash text NOT NULL UNIQUE,
  bundle jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS adapter_revisions (
  id uuid PRIMARY KEY,
  content_hash text NOT NULL UNIQUE,
  launch jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE runs ALTER COLUMN scene_revision_id DROP NOT NULL;
ALTER TABLE runs ALTER COLUMN evaluator_revision_id DROP NOT NULL;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS problem_revision_id uuid REFERENCES problem_revisions(id);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS adapter_revision_id uuid REFERENCES adapter_revisions(id);

ALTER TABLE runs ADD CONSTRAINT runs_revision_pair_check CHECK (
  (
    scene_revision_id IS NOT NULL AND evaluator_revision_id IS NOT NULL
    AND problem_revision_id IS NULL AND adapter_revision_id IS NULL
  ) OR (
    scene_revision_id IS NULL AND evaluator_revision_id IS NULL
    AND problem_revision_id IS NOT NULL AND adapter_revision_id IS NOT NULL
  )
);

ALTER TABLE run_front_members
  ADD COLUMN IF NOT EXISTS materialization jsonb;

CREATE TABLE IF NOT EXISTS run_events (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS run_events_sequence_idx ON run_events(run_id, sequence);
