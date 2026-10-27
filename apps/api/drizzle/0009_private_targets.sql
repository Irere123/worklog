-- Targets read by their member alone: their own email address, and a Slack DM to their own linked
-- user. Everything else keeps the column's default, team, so private data stops flowing to it.
UPDATE "delivery_targets" AS t SET "visibility" = 'private'
FROM "members" AS m
WHERE m."id" = t."member_id" AND t."kind" = 'email' AND lower(t."address") = lower(m."email");
--> statement-breakpoint
UPDATE "delivery_targets" AS t SET "visibility" = 'private'
WHERE t."kind" = 'slack' AND EXISTS (
  SELECT 1 FROM "identities" AS i
  WHERE i."member_id" = t."member_id" AND i."provider" = 'slack' AND i."external_id" = t."address"
);
