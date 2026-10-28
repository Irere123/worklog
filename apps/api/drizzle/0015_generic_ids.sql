-- A generic connection's event ids now count within the connection (they're prefixed with its id), so what it recorded before keeps matching its redeliveries.
UPDATE "activities" AS a
SET "external_id" = a."connection_id" || ':' || a."external_id"
FROM "connections" AS c
WHERE c."id" = a."connection_id"
  AND c."provider" IN ('webhook', 'custom')
  AND a."external_id" IS NOT NULL
  AND a."external_id" NOT LIKE c."id" || ':%';
--> statement-breakpoint
UPDATE "ingested_events" AS i
SET "external_id" = i."connection_id" || ':' || i."external_id"
FROM "connections" AS c
WHERE c."id" = i."connection_id"
  AND c."provider" IN ('webhook', 'custom')
  AND i."external_id" NOT LIKE c."id" || ':%'
  AND i."external_id" NOT LIKE 'state:%';
