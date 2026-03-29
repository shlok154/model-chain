# ModelChain Telemetry: Analytics Query Guide

Use these SQL templates in your Supabase SQL Editor to extract high-value product and engineering insights from the `telemetry_logs` table.

## 1. Product Conversion Funnel
Track the distribution of events to identify top-of-funnel engagement and bottom-of-funnel dropoffs.

```sql
SELECT 
  event, 
  COUNT(*) as total_events,
  COUNT(DISTINCT session_id) as unique_sessions
FROM telemetry_logs
WHERE created_at > now() - interval '7 days'
GROUP BY event
ORDER BY total_events DESC;
```

## 2. Purchase Failure Deep-Dive
Identify exactly why users are failing to complete transactions (e.g., "User Rejected", "Insufficient Funds").

```sql
SELECT 
  context->>'errorMessage' as error_reason,
  COUNT(*) as failure_count
FROM telemetry_logs
WHERE event = 'tx_failed'
  AND created_at > now() - interval '30 days'
GROUP BY error_reason
ORDER BY failure_count DESC;
```

## 3. RPC & Infrastructure Reliability
Monitor the health of your Alchemy/Sepolia provider connections and identify regional latency issues.

```sql
-- Calculate success vs failure rates for RPC calls
SELECT 
  event,
  COUNT(*) as count,
  ROUND(AVG((context->>'latency_ms')::numeric), 2) as avg_latency_ms
FROM telemetry_logs
WHERE event IN ('rpc_call', 'rpc_error')
GROUP BY event;
```

## 4. Stability & Crash Reporting
Monitor frontend Error Boundary catches sorted by frequency.

```sql
SELECT 
  context->>'error_message' as crash_reason,
  COUNT(*) as occurrence_count,
  MAX(created_at) as last_seen
FROM telemetry_logs
WHERE event = 'error_event_logged'
GROUP BY crash_reason
ORDER BY occurrence_count DESC;
```

---

### Implementation Notes:
- **Sampling**: `rpc_call` and `rpc_error` are sampled at 30% (`random > 0.3` skip) in the frontend. Multiply counts by ~3.33 for true estimates.
- **Priority**: Events marked as `critical` (like `error_event_logged`) bypass backend load-shedding and are always persisted.
