import { InfraiClient } from "./infrai_client.js";
import { decideShipmentEvent, shipmentEventSchema } from "./shipment_decision.js";

const key = process.env.INFRAI_API_KEY;
if (!key) throw new Error("Set INFRAI_API_KEY before running the worker");

const infrai = new InfraiClient(key, process.env.INFRAI_BASE_URL);
const batch = await infrai.consumeShipments(process.env.INFRAI_QUEUE ?? "shipments", 10, 30);

for (const message of batch.messages ?? []) {
  const event = shipmentEventSchema.parse(message.payload);
  const decision = decideShipmentEvent(event);
  if (decision.state === "exception") {
    await infrai.captureException(decision.capture, decision.idempotencyKey);
  }
  console.log(JSON.stringify({
    message_id: message.message_id,
    shipment_id: event.shipment_id,
    state: decision.state,
  }));
}
