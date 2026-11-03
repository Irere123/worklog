import { loadConfig } from "#config";
import { openDb } from "#db";
import { installQueue } from "#jobs/queue";

// The database's schema and the job queue's, brought up to date and nothing else: the step a
// deploy runs once before starting the new processes, so a migration that fails stops the
// deploy while the old version keeps serving. The processes also migrate at startup, so a setup
// without this step still works; with it, theirs finds nothing to do.
const config = loadConfig();
const { db, close } = await openDb(config.DATABASE_URL, 2);
await installQueue(db);
await close();
console.log("Migrations are up to date");
