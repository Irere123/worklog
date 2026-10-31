import { replayRating } from "#agent/replay";
import { loadConfig } from "#config";
import { createContext } from "#context";
import { listUnhelpfulRatings } from "#db/queries/conversations";
import { findMemberById } from "#db/queries/members";

// After changing a prompt, the constitution or the model: asks the replies people marked unhelpful
// again and prints each old answer beside the new one. Nothing is stored or sent.
// Usage: bun run ratings:replay <workspace id> [how many, default 20]
const [workspaceId, limit = "20"] = process.argv.slice(2);
if (!workspaceId) {
  console.error("Usage: bun run ratings:replay <workspace id> [how many]");
  process.exit(1);
}
const ctx = await createContext(loadConfig(process.env));
const cases = await listUnhelpfulRatings(ctx.db, {
  workspaceId,
  limit: Number(limit),
});
for (const c of cases) {
  const member = await findMemberById(ctx.db, { id: c.memberId, workspaceId });
  if (!member) {
    continue;
  }
  const r = await replayRating(ctx, member, c.id);
  console.log(
    [
      `# ${r.ratingId}`,
      `Asked: ${r.question ?? ""}`,
      `Why it was unhelpful: ${r.note ?? "(no note)"}`,
      `--- before\n${r.before ?? ""}`,
      `--- after\n${r.after}`,
      "",
    ].join("\n")
  );
}
await ctx.close();
