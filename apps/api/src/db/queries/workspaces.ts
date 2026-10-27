import { eq } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { workspaces } from "#db/schema";
import { notFound } from "#lib/errors";

export type Workspace = typeof workspaces.$inferSelect;

export async function insertWorkspace(db: DbOrTx, row: Workspace) {
  await db.insert(workspaces).values(row);
}

export async function getWorkspaceById(db: DbOrTx, params: { id: string }) {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, params.id));
  if (!row) {
    throw notFound("Workspace");
  }
  return row;
}

export async function countWorkspaces(db: DbOrTx) {
  return await db.$count(workspaces);
}
