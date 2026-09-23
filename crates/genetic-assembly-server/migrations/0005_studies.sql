CREATE TABLE studies (
 id text PRIMARY KEY,
 spec jsonb NOT NULL,
 runtime jsonb NOT NULL,
 problem_revision_id uuid NOT NULL REFERENCES problem_revisions(id),
 adapter_revision_id uuid NOT NULL REFERENCES adapter_revisions(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE study_runs (
 run_id uuid PRIMARY KEY REFERENCES runs(id),
 study_id text NOT NULL REFERENCES studies(id)
);
CREATE TABLE study_evaluations (
 id text PRIMARY KEY,
 study_id text NOT NULL REFERENCES studies(id),
 owner_id uuid NOT NULL,
 candidate_id text NOT NULL,
 phase text NOT NULL CHECK (phase IN ('baseline','search','validation','replay')),
 status text NOT NULL CHECK (status IN ('completed','invalid','failed')),
 cache_key text NOT NULL,
 data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_evaluations_history ON study_evaluations(owner_id,created_at,id);
CREATE INDEX study_evaluations_cache ON study_evaluations(cache_key) WHERE status='completed';
CREATE TABLE study_datasets (
 id text PRIMARY KEY,
 owner_id uuid NOT NULL,
 study_id text NOT NULL REFERENCES studies(id),
 data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE study_jobs (
 id uuid PRIMARY KEY,
 study_id text NOT NULL REFERENCES studies(id),
 kind text NOT NULL CHECK (kind IN ('baseline','replay')),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
 request jsonb NOT NULL,
 result jsonb,
 error text,
 cancel_requested boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
