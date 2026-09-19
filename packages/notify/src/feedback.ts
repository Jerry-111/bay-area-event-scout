import { z } from "zod";

export const feedbackTypeSchema = z.enum([
  "good",
  "bad",
  "very_my_type",
  "too_generic",
  "too_far",
  "want_intro",
  "not_relevant"
]);

export type FeedbackType = z.infer<typeof feedbackTypeSchema>;

export const feedbackPayloadSchema = z.object({
  eventId: z.string().min(1),
  type: feedbackTypeSchema,
  note: z.string().optional(),
  createdAt: z.string().optional()
});

export type FeedbackPayload = z.infer<typeof feedbackPayloadSchema>;

export function parseFeedbackPayload(input: URLSearchParams | Record<string, unknown>): FeedbackPayload {
  const raw =
    input instanceof URLSearchParams
      ? {
          eventId: input.get("eventId"),
          type: input.get("type"),
          note: input.get("note") ?? undefined
        }
      : input;

  const parsed = feedbackPayloadSchema.safeParse({
    ...raw,
    createdAt:
      typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : new Date().toISOString()
  });
  if (parsed.success) return parsed.data;

  throw new Error(
    `Invalid feedback payload: ${parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")}`
  );
}

export function buildFeedbackUrl(input: {
  appBaseUrl: string;
  eventId: string;
  type: FeedbackType;
  note?: string;
}): string {
  const url = new URL("/feedback", input.appBaseUrl);
  url.searchParams.set("eventId", input.eventId);
  url.searchParams.set("type", input.type);
  if (input.note) url.searchParams.set("note", input.note);
  return url.toString();
}

export async function handleFeedbackRequest(
  requestUrl: string,
  persist: (payload: FeedbackPayload) => Promise<void>
): Promise<{ ok: true; payload: FeedbackPayload }> {
  const url = new URL(requestUrl);
  const payload = parseFeedbackPayload(url.searchParams);
  await persist(payload);
  return { ok: true, payload };
}
