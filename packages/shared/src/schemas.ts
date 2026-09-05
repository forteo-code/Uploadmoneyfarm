import { z } from "zod";

export const emailSchema = z.string().email().max(254).toLowerCase();
export const passwordSchema = z.string().min(10).max(200);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().min(2).max(48).optional(),
  referralCode: z.string().max(32).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const createUploadSchema = z.object({
  filename: z.string().min(1).max(400),
  sizeBytes: z.number().int().positive().max(64 * 1024 * 1024 * 1024),
  mimeType: z.string().max(160).optional(),
  title: z.string().min(1).max(300).optional(),
  contentRating: z.enum(["SFW", "ADULT"]).default("SFW"),
});

export const completeUploadSchema = z.object({
  uploadId: z.string().min(1),
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1) }))
    .min(1),
});

export const updateVideoSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]).optional(),
  contentRating: z.enum(["SFW", "ADULT"]).optional(),
  tags: z.array(z.string().max(40)).max(25).optional(),
});

/**
 * Heartbeats are the backbone of view counting. `position` must advance
 * monotonically and plausibly; the server rejects sequences that do not.
 */
export const heartbeatSchema = z.object({
  token: z.string().min(20).max(600),
  position: z.number().min(0).max(24 * 60 * 60),
  watched: z.number().min(0).max(24 * 60 * 60),
  quality: z.number().int().min(0).max(2160).optional(),
  buffering: z.boolean().optional(),
});

export const adImpressionSchema = z.object({
  token: z.string().min(20).max(600),
  networkId: z.string().min(1).max(64),
  slotType: z.enum(["PREROLL", "POPUNDER", "OVERLAY", "BANNER", "INTERSTITIAL"]),
  filled: z.boolean(),
});

export const payoutRequestSchema = z.object({
  amountMicros: z.string().regex(/^\d+$/, "amountMicros must be an integer string"),
  method: z.enum(["CRYPTO_USDT_TRC20", "CRYPTO_BTC", "PAXUM", "WIRE"]),
  address: z.string().min(4).max(300),
});

export const dmcaNoticeSchema = z.object({
  claimantName: z.string().min(2).max(200),
  claimantEmail: emailSchema,
  claimantOrg: z.string().max(200).optional(),
  claimantAddress: z.string().min(5).max(600),
  claimantPhone: z.string().max(60).optional(),
  targetUrls: z.array(z.string().url().max(600)).min(1).max(200),
  workDescription: z.string().min(10).max(5000),
  goodFaithStatement: z.literal(true),
  accuracyStatement: z.literal(true),
  signature: z.string().min(2).max(200),
});

export const counterNoticeSchema = z.object({
  noticeId: z.string().min(1),
  statement: z.string().min(10).max(5000),
  consentToJurisdiction: z.literal(true),
  signature: z.string().min(2).max(200),
  address: z.string().min(5).max(600),
});

export const abuseReportSchema = z.object({
  videoId: z.string().min(1),
  category: z.enum(["CSAM", "NONCONSENSUAL", "TERRORISM", "ILLEGAL_OTHER", "MALWARE", "SPAM"]),
  details: z.string().max(5000).optional(),
  reporterEmail: emailSchema.optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUploadInput = z.infer<typeof createUploadSchema>;
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
export type DmcaNoticeInput = z.infer<typeof dmcaNoticeSchema>;
