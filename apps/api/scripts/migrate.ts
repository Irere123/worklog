import { loadConfig } from "#config";
import { openDb } from "#db";
import { installQueue } from "#jobs/queue";

const config = loadConfig();
const { db, close } = await openDb(config.DATABASE_URL, 2);
await installQueue(db);
await close();
console.log("Migrations are up to date");
