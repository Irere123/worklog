-- A generic connection's event ids now count within the connection (they're prefixed with its id), so what it recorded before keeps matching its redeliveries. An event recorded both ways (redelivered between the two changes) keeps its newer, prefixed row.
DELETE FROM "activities" AS a
USING "connections" AS c, "activities" AS twin
WHERE c."id" = a."connection_id"
  AND c."provider" IN ('webhook', 'custom')
  AND a."external_id" IS NOT NULL
  AND a."external_id" NOT LIKE c."id" || ':%'
  AND twin."workspace_id" = a."workspace_id"
  AND twin."source" = a."source"
  AND twin."external_id" = c."id" || ':' || a."external_id";
--> statement-breakpoint
UPDATE "activities" AS a
SET "external_id" = a."connection_id" || ':' || a."external_id"
FROM "connections" AS c
WHERE c."id" = a."connection_id"
  AND c."provider" IN ('webhook', 'custom')
  AND a."external_id" IS NOT NULL
  AND a."external_id" NOT LIKE c."id" || ':%';
--> statement-breakpoint
DELETE FROM "ingested_events" AS i
USING "connections" AS c, "ingested_events" AS twin
WHERE c."id" = i."connection_id"
  AND c."provider" IN ('webhook', 'custom')
  AND i."external_id" NOT LIKE c."id" || ':%'
  AND i."external_id" NOT LIKE 'state:%'
  AND twin."workspace_id" = i."workspace_id"
  AND twin."source" = i."source"
  AND twin."external_id" = c."id" || ':' || i."external_id";
--> statement-breakpoint
UPDATE "ingested_events" AS i
SET "external_id" = i."connection_id" || ':' || i."external_id"
FROM "connections" AS c
WHERE c."id" = i."connection_id"
  AND c."provider" IN ('webhook', 'custom')
  AND i."external_id" NOT LIKE c."id" || ':%'
  AND i."external_id" NOT LIKE 'state:%';
