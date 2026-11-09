import { createServer } from "node:http";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import { decideShipmentEvent, shipmentEventSchema } from "./shipment_decision.js";

const key = process.env.INFRAI_API_KEY;
if (!key) throw new Error("Set INFRAI_API_KEY before starting the service");
const infrai = new InfraiClient(key, process.env.INFRAI_BASE_URL);

function reply(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/shipment-events") {
    reply(response, 404, { error: "route not found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = shipmentEventSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) {
      reply(response, 400, { error: "invalid shipment event", issues: parsed.error.issues });
      return;
    }

    const decision = decideShipmentEvent(parsed.data);
    if (decision.state === "exception") {
      await infrai.captureException(decision.capture, decision.idempotencyKey);
    }
    reply(response, 202, { shipment_id: parsed.data.shipment_id, state: decision.state });
  } catch (error) {
    if (error instanceof SyntaxError) {
      reply(response, 400, { error: "request body must be JSON" });
    } else if (error instanceof InfraiError) {
      reply(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.detail,
      });
    } else {
      reply(response, 502, { error: "exception capture failed" });
    }
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`shipment exception service listening on :${port}`));
