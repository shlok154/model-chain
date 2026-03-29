# Final Polish: System Observability & Trust

This plan captures the final 5% of systematic, production-grade architecture as requested. We will connect the raw telemetry streams to durable storage, enforce rate limiting, guarantee correlation via session IDs, and surface backend security features visually to the end user.

## Proposed Changes

---

### Phase 1: Storage Infrastructure

#### [MODIFY] [schema.sql](file:///c:/Users/shlok/Downloads/model-chain-v7/model-chain-v6/supabase/schema.sql)
- **Feature:** Durable Telemetry Table.
- Append a `telemetry_logs` table at the end of the schema.
- Fields: `id`, `event`, `wallet_address`, `model_id`, `session_id`, `context` (JSONB), and `created_at`.
- End users will have zero direct RLS access; the backend (via service role) handles all insertions asynchronously.

#### [MODIFY] [analytics.py](file:///c:/Users/shlok/Downloads/model-chain-v7/model-chain-v6/backend/app/routes/analytics.py)
- **Feature:** Telemetry Sink & Validation.
- Update `_sink_event` to pipe incoming JSON directly into the Supabase `telemetry_logs` table.
- **Hardening:** Add strict payload size constraints and simple schema validation via Pydantic (`LogEventSchema`) to reject oversized `context` objects before attempting an insert.

---

### Phase 2: Frontend Correlation & UI

#### [MODIFY] [analytics.ts](file:///c:/Users/shlok/Downloads/model-chain-v7/model-chain-v6/src/lib/analytics.ts)
- **Feature:** Session Mapping.
- Instantiate a global `const sessionId = crypto.randomUUID()` on app boot.
- Inject `sessionId` into the root body of every `logEvent` payload. This guarantees perfect tracking across "Tx Initiated → Failed → Retry → Confirmed" pipelines for identical wallets and models.

#### [MODIFY] [ModelDetailPage.tsx](file:///c:/Users/shlok/Downloads/model-chain-v7/model-chain-v6/src/pages/ModelDetailPage.tsx)
- **Feature:** UI Trust Indicators.
- When `hasAccess` resolves to true inside the purchase card, conditionally render a highly polished list of trust indicators:
  - ✔️ Verified on-chain
  - ✔️ Secure IPFS download
  - ✔️ Immutable delivery
- These translate the "backend invisible logic" into explicit user value.
- When it comes to download integrity, we will rely on IPFS's native CID Content Addressing, since downloading via an exact `ipfs_hash` is inherently checksum-verified by the IPFS network protocol itself (impossible to serve modified data under the same hash).

## Open Questions

> [!IMPORTANT]
> Because telemetry logging will hit Supabase on *every* single frontend event, the connection pool or rate limit may be tested under extreme load. For this initial phase, I will add an immediate fire-and-forget `upsert` mechanism in `analytics.py` using `asyncio.create_task`. Is this acceptable for Phase 1, or do you require an in-memory batching/flushing queue straight away?

## Verification Plan

### Automated Tests
- I will run `psql` or `supabase db reset` locally to verify the new `telemetry_logs` table builds successfully without RLS conflicts.
### Manual Verification
- I will verify the UI renders the new Trust Indicators precisely.
- I will check the frontend network tab to guarantee `sessionId` consistently populates on analytics posts globally.
