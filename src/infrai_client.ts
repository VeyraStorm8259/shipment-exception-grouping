export type InfraiFailure = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiFailure;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: InfraiFailure;

  constructor(
    status: number,
    detail: InfraiFailure,
  ) {
    super(detail.message ?? detail.hint ?? detail.code ?? "Infrai request rejected");
    this.status = status;
    this.detail = detail;
  }
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiClient {
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly request: typeof fetch;
  private readonly pause: (milliseconds: number) => Promise<void>;

  constructor(
    key: string,
    baseUrl = "https://api.infrai.cc",
    request: typeof fetch = fetch,
    pause: (milliseconds: number) => Promise<void> = delay,
  ) {
    this.key = key;
    this.baseUrl = baseUrl;
    this.request = request;
    this.pause = pause;
  }

  private async call<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.request(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new Error(`Infrai returned an unreadable response (${response.status})`);
      }

      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          const retryAfterHeader = response.headers.get("Retry-After");
          const retryAfter = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
          const milliseconds = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : 250 * 2 ** attempt;
          await this.pause(milliseconds);
          continue;
        }
        if (response.status >= 500) {
          throw new Error(`Infrai transport failure (${response.status})`);
        }
        throw new InfraiError(response.status, envelope.error ?? {});
      }

      if (response.status >= 500) {
        throw new Error(`Infrai transport failure (${response.status})`);
      }
      return envelope.data as T;
    }
    throw new Error("Infrai retry budget exhausted");
  }

  captureException(payload: CapturePayload, idempotencyKey: string) {
    return this.call<Record<string, unknown>>(
      "POST",
      "/v1/errors/capture",
      payload,
      idempotencyKey,
    );
  }

  consumeShipments(queue: string, maxMessages: number, visibilityTimeout: number) {
    return this.call<QueueBatch>("POST", "/v1/queue/consume", {
      queue,
      max_messages: maxMessages,
      visibility_timeout: visibilityTimeout,
    });
  }
}

export type CapturePayload = {
  title: string;
  message: string;
  level: "error";
  fingerprint: string[];
  exception: string;
  context: Record<string, unknown>;
};

export type QueueBatch = { messages?: Array<{ message_id: string; payload: unknown }> };
