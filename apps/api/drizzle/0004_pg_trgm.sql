-- Memory recall matches misspelled words ("pazta" finds "pasta") with word_similarity. pg_trgm ships
-- with Postgres and is a trusted extension, so the database owner can create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
