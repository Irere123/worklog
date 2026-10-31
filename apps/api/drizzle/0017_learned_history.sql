-- The nightly memory pass has already read what was said before conversations learned on their own,
-- so they start learning from the next message rather than going over their history again.
UPDATE "conversations" AS c
SET "learned_through_seq" = m."last_seq"
FROM (
  SELECT "conversation_id", max("seq") AS "last_seq"
  FROM "messages"
  GROUP BY "conversation_id"
) AS m
WHERE m."conversation_id" = c."id";
