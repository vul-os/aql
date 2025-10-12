# Supabase Setup Guide

## Install Supabase CLI

### Linux / macOS
```bash
# Using npm (recommended if you already have Node.js)
npm install -g supabase

# Or using Homebrew (macOS)
brew install supabase/tap/supabase

# Or using direct download
curl -sL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz | tar -xz
sudo mv supabase /usr/local/bin/
```

### Windows
```powershell
# Using Scoop
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Or download from: https://github.com/supabase/cli/releases
```

## Initial Setup

### 1. Initialize Supabase (Already Done)
```bash
# This creates supabase/ directory with config.toml
supabase init

# ✅ Already complete for BotKorp
```

### 2. Start Local Development Environment
```bash
# Start all Supabase services (Postgres, Auth, Storage, etc.)
supabase start

# This will output:
# - API URL: http://localhost:54321
# - DB URL: postgresql://postgres:postgres@localhost:54322/postgres
# - Studio URL: http://localhost:54323
# - Inbucket URL: http://localhost:54324
```

### 3. Apply Migrations
```bash
# Reset database and apply all migrations + seed data
supabase db reset

# Or apply only new migrations
supabase migration up
```

### 4. Open Supabase Studio
```bash
# Studio is available at: http://localhost:54323
# You can view tables, run queries, and manage your database
```

## Quick Start (After CLI Installation)

```bash
cd /home/imran/Documents/botkorp-mono

# Start Supabase
supabase start

# Apply your schema
supabase db reset

# Open Studio to view your tables
open http://localhost:54323  # or visit in browser
```

## Link to Production

### 1. Create Supabase Project
1. Go to https://supabase.com
2. Create new project
3. Note your project reference ID

### 2. Link Local to Production
```bash
# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref-here

# Push migrations to production
supabase db push
```

## Common Commands Cheat Sheet

```bash
# Start/Stop Services
supabase start           # Start all services
supabase stop            # Stop all services
supabase status          # Check service status

# Database Migrations
supabase migration new <name>     # Create new migration
supabase db reset                 # Reset DB + apply all migrations + seed
supabase migration up             # Apply pending migrations only
supabase db diff -f <name>        # Generate migration from changes

# Database Management
supabase db push                  # Push migrations to remote
supabase db pull                  # Pull remote schema
supabase db dump -f dump.sql      # Backup database

# Testing
psql postgresql://postgres:postgres@localhost:54322/postgres
# Or use Studio: http://localhost:54323
```

## Troubleshooting

### Port Already in Use
```bash
# If ports are in use, stop Supabase first
supabase stop

# Or change ports in supabase/config.toml
```

### Reset Everything
```bash
# Nuclear option - removes all containers and data
supabase stop --no-backup
docker system prune -a
supabase start
supabase db reset
```

### View Logs
```bash
# Check container logs
docker logs supabase_db_botkorp-mono
docker logs supabase_kong_botkorp-mono
```

## Verify Installation

After installing Supabase CLI, verify it works:

```bash
# Check version
supabase --version

# Should output something like:
# supabase 1.x.x
```

## Next Steps

1. **Install Supabase CLI** using one of the methods above
2. **Run `supabase start`** to spin up local environment
3. **Run `supabase db reset`** to apply the BotKorp schema
4. **Open Studio** at http://localhost:54323 to explore your database
5. **Start developing!** Your database is ready with all tables and seed data

## Need Help?

- [Supabase CLI Docs](https://supabase.com/docs/guides/cli)
- [Supabase Local Development](https://supabase.com/docs/guides/cli/local-development)
- [Supabase Community](https://github.com/supabase/supabase/discussions)

