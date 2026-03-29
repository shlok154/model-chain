# Supabase — ModelChain

## Migration system

All schema changes live in `supabase/migrations/` as numbered SQL files.
**Never edit `schema.sql` directly for new changes — always create a new migration.**

### Running migrations

#### Local dev (Supabase CLI)
```bash
# Install CLI
brew install supabase/tap/supabase

# Start local Supabase
supabase start

# Apply all migrations
supabase db push

# Create a new migration
supabase migration new my_change_name
# → creates supabase/migrations/YYYYMMDDHHMMSS_my_change_name.sql
# Edit the file, then run: supabase db push
```

#### Production
```bash
# Link to your Supabase project
supabase link --project-ref your-project-ref

# Push migrations to production
supabase db push

# Or run individual SQL files via Supabase Dashboard → SQL Editor
```

## Migration history

| File | Description |
|---|---|
| `20240101000000_initial_schema.sql` | v1: users, models, purchases, RLS policies |
| `20240201000000_v2_reviews_nodes_transactions.sql` | v2: reviews, nodes, transactions tables |

## Adding a new migration

```bash
supabase migration new descriptive_name
```

This creates `supabase/migrations/TIMESTAMP_descriptive_name.sql`.
Write your SQL there — always use `if not exists` and `or replace` for safety.
