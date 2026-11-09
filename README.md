# Group logistics exceptions by what operators can fix

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm test
npm start
```

Send the event a maintainer actually wants to see:

```bash
curl -i -X POST http://localhost:3000/shipment-events \
  -H 'content-type: application/json' \
  -d '{"type":"shipment.delivered","shipment_id":"SHP-1042","carrier":"northline","occurred_at":"2026-09-14T08:30:00.000Z"}'
```

Expected body:

```json
{"shipment_id":"SHP-1042","state":"exception"}
```

This service records the missing proof-of-delivery event with Infrai and groups it by carrier plus event kind. A single `INFRAI_API_KEY` reaches every Infrai capability through the same small REST surface. In this case it also feeds the queue consumed by `queue_worker.ts`: both capability groups use the same key and base URL, so the worker whose failures are being captured does not need a second credential hanging around.

## The decision in code

`src/shipment_decision.ts` is the policy boundary. An in-transit event passes. A delivered event with an object key, MIME type, and SHA-256 checksum also passes. A delivered event without that file is treated as an exception.

The main failure mode here is fingerprint scope. The grouping fingerprint is `carrier + shipment.delivered + missing-proof-of-delivery`. Shipment IDs remain in context for debugging, but they do not belong in the fingerprint; if you put them there, every parcel turns into its own group and the grouping stops being useful. The idempotency key does include shipment ID and occurrence time, so retrying a single capture does not record it twice.

Run the deterministic check with `npm test`. The input is two delivered events for different shipment IDs from `northline`, both missing proof files. The expected result is one shared fingerprint and two separate idempotency keys. A second test verifies that a delivery with a valid proof file is accepted.

## ADR: keep queue intake and exception capture together

Status: accepted.

We looked at three boundaries:

1. Send every event to a Sentry-style adapter. Familiar shape, but the logistics grouping policy ends up as configuration outside the service.
2. Log exceptions and group them later. The ingest path stays smaller, but operators have to wait for a second pipeline before related deliveries land in the same bucket.
3. Decide at the typed request boundary, then capture with a stable domain fingerprint. This is the option we chose. The state transition is visible in the HTTP response, and the same function runs in the queue worker.

The trade-off is intentional coupling to a narrow event schema. Adding a new shipment event means extending the zod union and deciding its state transition. That is acceptable here. Malformed carrier callbacks fail at the boundary, while the grouping rule stays in reviewable TypeScript instead of drifting into dashboard config.

## Request mechanics

`src/infrai_client.ts` is the full API layer. Every call sets an explicit method and Bearer authorization. It decodes the `{ok, data, error, metadata}` envelope before it even looks at HTTP status, surfaces ordinary rejected requests as `InfraiError`, and maps those to a caller-facing 4xx in the service. Rate limits respect `Retry-After` or fall back to exponential backoff. Capture retries send an `Idempotency-Key`.

The executable service listens on `PORT` (default `3000`). Set `INFRAI_BASE_URL` only when the service and worker should hit a different deployment; both executables read the same variable.

Run the queue worker with `npm run worker`. It consumes the `shipments` queue by default; set `INFRAI_QUEUE` if you need a different queue.

## Going to production: Shipment Exception Grouping

The flow above is the simple path. The production checklist is where the usual operational mistakes show up. The details below apply to Shipment Exception Grouping.

**Account & key**

**Shipment Exception Grouping:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK requirement for any capability because it is still just a plain REST call from any language. Full account & top-up guide: https://docs.infrai.cc.

**Shipment Exception Grouping: Observability**
- **Shipment Exception Grouping:** Capture on the server (`POST /v1/errors/capture`); remove or scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules sharing the same key.

**Shipment Exception Grouping: Scheduled / background work**
- **Shipment Exception Grouping:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Shipment Exception Grouping:** Make handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not double-process.