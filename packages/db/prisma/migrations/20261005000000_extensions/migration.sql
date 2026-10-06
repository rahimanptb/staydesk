-- Extensions required before any table is created.
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive emails and slugs
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- equality + range in one EXCLUDE constraint
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy guest search
