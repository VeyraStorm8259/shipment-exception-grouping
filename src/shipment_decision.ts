import { createHash } from "node:crypto";
import { z } from "zod";
import type { CapturePayload } from "./infrai_client.js";

export const shipmentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("shipment.in_transit"),
    shipment_id: z.string().min(1),
    carrier: z.string().min(1),
    occurred_at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("shipment.delivered"),
    shipment_id: z.string().min(1),
    carrier: z.string().min(1),
    occurred_at: z.string().datetime(),
    proof_of_delivery: z.object({
      object_key: z.string().min(1),
      content_type: z.enum(["image/jpeg", "image/png", "application/pdf"]),
      checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }).optional(),
  }),
]);

export type ShipmentEvent = z.infer<typeof shipmentEventSchema>;

export type ShipmentDecision =
  | { state: "accepted" }
  | { state: "exception"; capture: CapturePayload; idempotencyKey: string };

export function decideShipmentEvent(event: ShipmentEvent): ShipmentDecision {
  if (event.type !== "shipment.delivered" || event.proof_of_delivery) {
    return { state: "accepted" };
  }

  const message = `Delivery ${event.shipment_id} has no proof-of-delivery file`;
  return {
    state: "exception",
    idempotencyKey: createHash("sha256")
      .update(`${event.shipment_id}:${event.occurred_at}:missing-pod`)
      .digest("hex"),
    capture: {
      title: "Delivered shipment missing proof of delivery",
      message,
      level: "error",
      fingerprint: [event.carrier, event.type, "missing-proof-of-delivery"],
      exception: message,
      context: {
        shipment_id: event.shipment_id,
        carrier: event.carrier,
        occurred_at: event.occurred_at,
      },
    },
  };
}
