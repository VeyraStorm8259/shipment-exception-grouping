import assert from "node:assert/strict";
import test from "node:test";
import { decideShipmentEvent, shipmentEventSchema } from "../src/shipment_decision.js";

test("missing proof groups by carrier and event kind, not shipment id", () => {
  const first = shipmentEventSchema.parse({
    type: "shipment.delivered",
    shipment_id: "SHP-1042",
    carrier: "northline",
    occurred_at: "2026-09-14T08:30:00.000Z",
  });
  const second = shipmentEventSchema.parse({
    ...first,
    shipment_id: "SHP-1043",
  });

  const firstDecision = decideShipmentEvent(first);
  const secondDecision = decideShipmentEvent(second);
  assert.equal(firstDecision.state, "exception");
  assert.equal(secondDecision.state, "exception");
  if (firstDecision.state === "exception" && secondDecision.state === "exception") {
    assert.deepEqual(firstDecision.capture.fingerprint, [
      "northline",
      "shipment.delivered",
      "missing-proof-of-delivery",
    ]);
    assert.deepEqual(firstDecision.capture.fingerprint, secondDecision.capture.fingerprint);
    assert.notEqual(firstDecision.idempotencyKey, secondDecision.idempotencyKey);
  }
});

test("delivered event with a proof file is accepted", () => {
  const event = shipmentEventSchema.parse({
    type: "shipment.delivered",
    shipment_id: "SHP-1044",
    carrier: "northline",
    occurred_at: "2026-09-14T08:35:00.000Z",
    proof_of_delivery: {
      object_key: "pod/SHP-1044.pdf",
      content_type: "application/pdf",
      checksum_sha256: "a".repeat(64),
    },
  });
  assert.deepEqual(decideShipmentEvent(event), { state: "accepted" });
});
