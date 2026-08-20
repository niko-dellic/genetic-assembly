CREATE TABLE IF NOT EXISTS scene_revisions (
  id uuid PRIMARY KEY,
  content_hash text NOT NULL UNIQUE,
  manifest jsonb NOT NULL,
  artifact_key text NOT NULL,
  object_count integer NOT NULL,
  mesh_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evaluator_revisions (
  id uuid PRIMARY KEY,
  source_hash text NOT NULL UNIQUE,
  source text NOT NULL,
  manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY,
  scene_revision_id uuid NOT NULL REFERENCES scene_revisions(id),
  evaluator_revision_id uuid NOT NULL REFERENCES evaluator_revisions(id),
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
  config jsonb NOT NULL,
  current_generation integer NOT NULL DEFAULT 0,
  checkpoint_key text,
  result_key text,
  cancel_requested boolean NOT NULL DEFAULT false,
  lease_expires_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS runs_claimable_idx ON runs(status, created_at);

CREATE TABLE IF NOT EXISTS generation_summaries (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  summary jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, generation)
);

CREATE TABLE IF NOT EXISTS run_front_members (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  member_index integer NOT NULL,
  individual jsonb NOT NULL,
  patches jsonb NOT NULL,
  PRIMARY KEY (run_id, member_index)
);
