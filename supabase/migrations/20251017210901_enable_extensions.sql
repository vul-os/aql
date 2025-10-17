-- =====================================================
-- Enable PostgreSQL Extensions
-- =====================================================

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Geographic data (for coverage areas and location coordinates)
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Cron jobs for automated billing
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- Comments
COMMENT ON EXTENSION "uuid-ossp" IS 'UUID generation functions';
COMMENT ON EXTENSION "postgis" IS 'Geographic objects and functions';
COMMENT ON EXTENSION "pg_cron" IS 'Job scheduler for PostgreSQL';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Extensions enabled: uuid-ossp, postgis, pg_cron';
END $$;

