-- =====================================================
-- MANUAL DATABASE RESET
-- Run this in Supabase SQL Editor if `supabase db reset` fails
-- =====================================================

-- This script drops everything except extension-owned objects
-- and then you can run the migrations manually

DO $$ 
DECLARE
  rec record;
BEGIN
  -- Drop all policies first
  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    RAISE NOTICE 'Dropping policy: % on %.%', rec.policyname, rec.schemaname, rec.tablename;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I CASCADE', rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;

  -- Drop all views
  FOR rec IN
    SELECT schemaname, viewname
    FROM pg_views
    WHERE schemaname = 'public'
  LOOP
    RAISE NOTICE 'Dropping view: %.%', rec.schemaname, rec.viewname;
    EXECUTE format('DROP VIEW IF EXISTS %I.%I CASCADE', rec.schemaname, rec.viewname);
  END LOOP;

  -- Drop all materialized views
  FOR rec IN
    SELECT schemaname, matviewname
    FROM pg_matviews
    WHERE schemaname = 'public'
  LOOP
    RAISE NOTICE 'Dropping materialized view: %.%', rec.schemaname, rec.matviewname;
    EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS %I.%I CASCADE', rec.schemaname, rec.matviewname);
  END LOOP;

  -- Drop all tables
  FOR rec IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    RAISE NOTICE 'Dropping table: %.%', rec.schemaname, rec.tablename;
    EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', rec.schemaname, rec.tablename);
  END LOOP;

  -- Drop all functions (excluding extension-owned ones)
  FOR rec IN
    SELECT n.nspname as schema_name, p.proname as function_name,
           pg_catalog.pg_get_function_identity_arguments(p.oid) as args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public'
      AND d.objid IS NULL  -- Exclude extension-owned functions
  LOOP
    RAISE NOTICE 'Dropping function: %.%', rec.schema_name, rec.function_name;
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', 
                   rec.schema_name, rec.function_name, rec.args);
  END LOOP;

  -- Drop all sequences
  FOR rec IN
    SELECT schemaname, sequencename
    FROM pg_sequences
    WHERE schemaname = 'public'
  LOOP
    RAISE NOTICE 'Dropping sequence: %.%', rec.schemaname, rec.sequencename;
    EXECUTE format('DROP SEQUENCE IF EXISTS %I.%I CASCADE', rec.schemaname, rec.sequencename);
  END LOOP;

  -- Drop all types (excluding base types and extension types)
  FOR rec IN
    SELECT n.nspname as schema_name, t.typname as type_name
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    LEFT JOIN pg_depend d ON d.objid = t.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public'
      AND t.typtype != 'b'  -- Exclude base types
      AND d.objid IS NULL   -- Exclude extension-owned types
  LOOP
    RAISE NOTICE 'Dropping type: %.%', rec.schema_name, rec.type_name;
    EXECUTE format('DROP TYPE IF EXISTS %I.%I CASCADE', rec.schema_name, rec.type_name);
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '=== DATABASE CLEANED SUCCESSFULLY ===';
  RAISE NOTICE 'You can now apply migrations manually or use supabase db push';
END $$;

