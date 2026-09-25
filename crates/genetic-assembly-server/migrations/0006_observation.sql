CREATE TABLE operation_events (
 owner_id uuid NOT NULL,
 sequence bigint GENERATED ALWAYS AS IDENTITY,
 event_key text NOT NULL,
 event jsonb NOT NULL,
 PRIMARY KEY(owner_id,sequence),
 UNIQUE(owner_id,event_key)
);
CREATE TABLE operation_generations (
 owner_id uuid NOT NULL REFERENCES runs(id),
 generation integer NOT NULL,
 snapshot jsonb NOT NULL,
 checkpoint jsonb NOT NULL,
 PRIMARY KEY(owner_id,generation)
);

-- Commit terminal observations with their status, including queued cancellations.
CREATE FUNCTION record_operation_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE detail jsonb;
BEGIN
 IF NEW.status IN ('completed','failed','cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id::text,0));
  IF NEW.status='failed' THEN
   SELECT data->'errorDetail' INTO detail FROM study_evaluations
    WHERE owner_id=NEW.id AND status='failed' AND data ? 'errorDetail' ORDER BY created_at LIMIT 1;
   detail := COALESCE(detail,jsonb_build_object('code','OPERATION_FAILED','stage','service','message',COALESCE(NEW.error,'Service operation failed')));
  END IF;
  INSERT INTO operation_events(owner_id,event_key,event) VALUES(NEW.id,'terminal',
   jsonb_build_object('operationId',NEW.id,'type',NEW.status,'active',0,'queued',0) ||
   CASE WHEN detail IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('error',detail) END)
   ON CONFLICT(owner_id,event_key) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER run_terminal_event AFTER UPDATE OF status ON runs FOR EACH ROW EXECUTE FUNCTION record_operation_terminal();
CREATE TRIGGER job_terminal_event AFTER UPDATE OF status ON study_jobs FOR EACH ROW EXECUTE FUNCTION record_operation_terminal();
