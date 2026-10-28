-- The ledger claims an event before its activity is written, already pointing at the id the activity will get; the reference is checked when the transaction commits.
ALTER TABLE "ingested_events" ALTER CONSTRAINT "ingested_events_activity_id_activities_id_fk" DEFERRABLE INITIALLY DEFERRED;
