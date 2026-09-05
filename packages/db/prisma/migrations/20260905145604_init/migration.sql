-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('UPLOADER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('UPLOADING', 'QUEUED', 'TRANSCODING', 'READY', 'FAILED', 'BLOCKED', 'DMCA_REMOVED', 'DELETED');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ContentRating" AS ENUM ('SFW', 'ADULT');

-- CreateEnum
CREATE TYPE "ModerationState" AS ENUM ('PENDING', 'CLEARED', 'QUARANTINED', 'REPORTED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('EARNING', 'REFERRAL', 'ADJUSTMENT', 'CLAWBACK', 'PAYOUT', 'PAYOUT_REVERSAL');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('CRYPTO_USDT_TRC20', 'CRYPTO_BTC', 'PAXUM', 'WIRE');

-- CreateEnum
CREATE TYPE "DmcaStatus" AS ENUM ('RECEIVED', 'ACTIONED', 'REJECTED', 'COUNTER_NOTICED', 'REINSTATED');

-- CreateEnum
CREATE TYPE "StrikeReason" AS ENUM ('DMCA', 'ILLEGAL_CONTENT', 'FRAUD', 'TOS');

-- CreateEnum
CREATE TYPE "AdSlotType" AS ENUM ('PREROLL', 'POPUNDER', 'OVERLAY', 'BANNER', 'INTERSTITIAL');

-- CreateEnum
CREATE TYPE "AbuseCategory" AS ENUM ('CSAM', 'NONCONSENSUAL', 'TERRORISM', 'ILLEGAL_OTHER', 'MALWARE', 'SPAM');

-- CreateEnum
CREATE TYPE "AbuseStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'UPLOADER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "payoutMethod" "PayoutMethod",
    "payoutAddress" TEXT,
    "minPayoutMicros" BIGINT NOT NULL DEFAULT 50000000,
    "revShareBps" INTEGER NOT NULL DEFAULT 3500,
    "fraudScore" INTEGER NOT NULL DEFAULT 0,
    "strikeCount" INTEGER NOT NULL DEFAULT 0,
    "balanceFrozen" BOOLEAN NOT NULL DEFAULT false,
    "terminatedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "signupIpHash" TEXT,
    "signupCountry" TEXT,
    "ageVerifiedAt" TIMESTAMP(3),
    "recordKeepingRef" TEXT,
    "referralCode" TEXT NOT NULL,
    "referredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "VideoStatus" NOT NULL DEFAULT 'UPLOADING',
    "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
    "contentRating" "ContentRating" NOT NULL DEFAULT 'SFW',
    "moderation" "ModerationState" NOT NULL DEFAULT 'PENDING',
    "blockedReason" TEXT,
    "sourceKey" TEXT,
    "sourceBytes" BIGINT NOT NULL DEFAULT 0,
    "sourceMime" TEXT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "fps" DOUBLE PRECISION,
    "videoCodec" TEXT,
    "audioCodec" TEXT,
    "sha256" TEXT,
    "phash" TEXT,
    "hlsMasterKey" TEXT,
    "posterKey" TEXT,
    "spriteKey" TEXT,
    "spriteVttKey" TEXT,
    "storageBytes" BIGINT NOT NULL DEFAULT 0,
    "viewCount" BIGINT NOT NULL DEFAULT 0,
    "countableViewCount" BIGINT NOT NULL DEFAULT 0,
    "earnedMicros" BIGINT NOT NULL DEFAULT 0,
    "transcodeAttempts" INTEGER NOT NULL DEFAULT 0,
    "transcodeError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoVariant" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "height" INTEGER NOT NULL,
    "bitrateKbps" INTEGER NOT NULL,
    "playlistKey" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "codec" TEXT NOT NULL DEFAULT 'h264',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybackSession" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "uaHash" TEXT NOT NULL,
    "country" TEXT,
    "asn" INTEGER,
    "isDatacenter" BOOLEAN NOT NULL DEFAULT false,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "referrerDomain" TEXT,
    "embedDomain" TEXT,
    "cpmTier" INTEGER NOT NULL DEFAULT 3,
    "servedMaxHeight" INTEGER NOT NULL DEFAULT 480,
    "heartbeatCount" INTEGER NOT NULL DEFAULT 0,
    "watchedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastPosition" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastHeartbeatAt" TIMESTAMP(3),
    "firstHeartbeatAt" TIMESTAMP(3),
    "countedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybackSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "View" (
    "id" BIGSERIAL NOT NULL,
    "videoId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "playbackSessionId" TEXT,
    "visitorHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "country" TEXT,
    "asn" INTEGER,
    "isDatacenter" BOOLEAN NOT NULL DEFAULT false,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "userAgentFamily" TEXT,
    "referrerDomain" TEXT,
    "embedDomain" TEXT,
    "watchedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heartbeats" INTEGER NOT NULL DEFAULT 0,
    "isCountable" BOOLEAN NOT NULL DEFAULT false,
    "fraudReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cpmTier" INTEGER NOT NULL DEFAULT 3,
    "earnedMicros" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "View_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewRollupHourly" (
    "id" BIGSERIAL NOT NULL,
    "videoId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "hourStart" TIMESTAMP(3) NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'XX',
    "cpmTier" INTEGER NOT NULL DEFAULT 3,
    "views" BIGINT NOT NULL DEFAULT 0,
    "countableViews" BIGINT NOT NULL DEFAULT 0,
    "watchedSeconds" BIGINT NOT NULL DEFAULT 0,
    "adImpressions" BIGINT NOT NULL DEFAULT 0,
    "grossMicros" BIGINT NOT NULL DEFAULT 0,
    "uploaderMicros" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ViewRollupHourly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdNetwork" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slotType" "AdSlotType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "scriptTemplate" TEXT,
    "vastTemplate" TEXT,
    "geoAllow" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "geoDeny" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "frequencyCapPerHour" INTEGER NOT NULL DEFAULT 1,
    "estCpmMicros" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdImpression" (
    "id" TEXT NOT NULL,
    "playbackSessionId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "slotType" "AdSlotType" NOT NULL,
    "country" TEXT,
    "cpmTier" INTEGER NOT NULL DEFAULT 3,
    "filled" BOOLEAN NOT NULL DEFAULT true,
    "estRevenueMicros" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdImpression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "videoId" TEXT,
    "refType" TEXT,
    "refKey" TEXT,
    "description" TEXT,
    "availableAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversesId" TEXT,
    "payoutRequestId" TEXT,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "method" "PayoutMethod" NOT NULL,
    "address" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "reviewerId" TEXT,
    "reviewNotes" TEXT,
    "providerRef" TEXT,
    "failureReason" TEXT,
    "fraudScoreAtRequest" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmcaNotice" (
    "id" TEXT NOT NULL,
    "claimantName" TEXT NOT NULL,
    "claimantEmail" TEXT NOT NULL,
    "claimantOrg" TEXT,
    "claimantAddress" TEXT NOT NULL,
    "claimantPhone" TEXT,
    "workDescription" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "goodFaithStatement" BOOLEAN NOT NULL DEFAULT false,
    "accuracyStatement" BOOLEAN NOT NULL DEFAULT false,
    "status" "DmcaStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "actionedAt" TIMESTAMP(3),
    "actionedById" TEXT,
    "rejectionReason" TEXT,
    "sourceIpHash" TEXT,
    "rawSubmission" JSONB,

    CONSTRAINT "DmcaNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmcaTarget" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "videoId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DmcaTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounterNotice" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "consentToJurisdiction" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reinstatedAt" TIMESTAMP(3),

    CONSTRAINT "CounterNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Strike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "StrikeReason" NOT NULL,
    "videoId" TEXT,
    "noticeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "Strike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbuseReport" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "category" "AbuseCategory" NOT NULL,
    "details" TEXT,
    "reporterEmail" TEXT,
    "reporterIpHash" TEXT,
    "status" "AbuseStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,

    CONSTRAINT "AbuseReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedHash" (
    "id" TEXT NOT NULL,
    "algo" TEXT NOT NULL DEFAULT 'phash',
    "hash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'INTERNAL',
    "severity" TEXT NOT NULL DEFAULT 'BLOCK',
    "note" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedHash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountryConfig" (
    "code" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 3,
    "rpmMicros" BIGINT NOT NULL DEFAULT 350000,
    "maxHeight" INTEGER NOT NULL DEFAULT 480,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountryConfig_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

-- CreateIndex
CREATE INDEX "User_fraudScore_idx" ON "User"("fraudScore");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Video_slug_key" ON "Video"("slug");

-- CreateIndex
CREATE INDEX "Video_ownerId_createdAt_idx" ON "Video"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Video_status_visibility_createdAt_idx" ON "Video"("status", "visibility", "createdAt");

-- CreateIndex
CREATE INDEX "Video_sha256_idx" ON "Video"("sha256");

-- CreateIndex
CREATE INDEX "Video_phash_idx" ON "Video"("phash");

-- CreateIndex
CREATE INDEX "Video_lastViewedAt_idx" ON "Video"("lastViewedAt");

-- CreateIndex
CREATE INDEX "Video_moderation_idx" ON "Video"("moderation");

-- CreateIndex
CREATE INDEX "VideoVariant_videoId_idx" ON "VideoVariant"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoVariant_videoId_height_key" ON "VideoVariant"("videoId", "height");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackSession_tokenHash_key" ON "PlaybackSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PlaybackSession_videoId_createdAt_idx" ON "PlaybackSession"("videoId", "createdAt");

-- CreateIndex
CREATE INDEX "PlaybackSession_expiresAt_idx" ON "PlaybackSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "View_playbackSessionId_key" ON "View"("playbackSessionId");

-- CreateIndex
CREATE INDEX "View_videoId_createdAt_idx" ON "View"("videoId", "createdAt");

-- CreateIndex
CREATE INDEX "View_uploaderId_createdAt_idx" ON "View"("uploaderId", "createdAt");

-- CreateIndex
CREATE INDEX "View_visitorHash_idx" ON "View"("visitorHash");

-- CreateIndex
CREATE INDEX "View_createdAt_idx" ON "View"("createdAt");

-- CreateIndex
CREATE INDEX "View_isCountable_createdAt_idx" ON "View"("isCountable", "createdAt");

-- CreateIndex
CREATE INDEX "ViewRollupHourly_uploaderId_hourStart_idx" ON "ViewRollupHourly"("uploaderId", "hourStart");

-- CreateIndex
CREATE INDEX "ViewRollupHourly_hourStart_idx" ON "ViewRollupHourly"("hourStart");

-- CreateIndex
CREATE UNIQUE INDEX "ViewRollupHourly_videoId_hourStart_country_key" ON "ViewRollupHourly"("videoId", "hourStart", "country");

-- CreateIndex
CREATE UNIQUE INDEX "AdNetwork_key_key" ON "AdNetwork"("key");

-- CreateIndex
CREATE INDEX "AdNetwork_slotType_enabled_priority_idx" ON "AdNetwork"("slotType", "enabled", "priority");

-- CreateIndex
CREATE INDEX "AdImpression_networkId_createdAt_idx" ON "AdImpression"("networkId", "createdAt");

-- CreateIndex
CREATE INDEX "AdImpression_videoId_createdAt_idx" ON "AdImpression"("videoId", "createdAt");

-- CreateIndex
CREATE INDEX "AdImpression_uploaderId_createdAt_idx" ON "AdImpression"("uploaderId", "createdAt");

-- CreateIndex
CREATE INDEX "AdImpression_country_networkId_createdAt_idx" ON "AdImpression"("country", "networkId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_reversesId_key" ON "LedgerEntry"("reversesId");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_availableAt_idx" ON "LedgerEntry"("userId", "availableAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_type_createdAt_idx" ON "LedgerEntry"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_refType_refKey_key" ON "LedgerEntry"("refType", "refKey");

-- CreateIndex
CREATE INDEX "PayoutRequest_status_requestedAt_idx" ON "PayoutRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "PayoutRequest_userId_requestedAt_idx" ON "PayoutRequest"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "DmcaNotice_status_dueAt_idx" ON "DmcaNotice"("status", "dueAt");

-- CreateIndex
CREATE INDEX "DmcaNotice_receivedAt_idx" ON "DmcaNotice"("receivedAt");

-- CreateIndex
CREATE INDEX "DmcaTarget_noticeId_idx" ON "DmcaTarget"("noticeId");

-- CreateIndex
CREATE INDEX "DmcaTarget_videoId_idx" ON "DmcaTarget"("videoId");

-- CreateIndex
CREATE INDEX "CounterNotice_noticeId_idx" ON "CounterNotice"("noticeId");

-- CreateIndex
CREATE INDEX "CounterNotice_userId_idx" ON "CounterNotice"("userId");

-- CreateIndex
CREATE INDEX "Strike_userId_expiresAt_idx" ON "Strike"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AbuseReport_status_category_createdAt_idx" ON "AbuseReport"("status", "category", "createdAt");

-- CreateIndex
CREATE INDEX "AbuseReport_videoId_idx" ON "AbuseReport"("videoId");

-- CreateIndex
CREATE INDEX "BlockedHash_algo_idx" ON "BlockedHash"("algo");

-- CreateIndex
CREATE UNIQUE INDEX "BlockedHash_algo_hash_key" ON "BlockedHash"("algo", "hash");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "CountryConfig_tier_idx" ON "CountryConfig"("tier");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoVariant" ADD CONSTRAINT "VideoVariant_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackSession" ADD CONSTRAINT "PlaybackSession_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_playbackSessionId_fkey" FOREIGN KEY ("playbackSessionId") REFERENCES "PlaybackSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewRollupHourly" ADD CONSTRAINT "ViewRollupHourly_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdImpression" ADD CONSTRAINT "AdImpression_playbackSessionId_fkey" FOREIGN KEY ("playbackSessionId") REFERENCES "PlaybackSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdImpression" ADD CONSTRAINT "AdImpression_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdImpression" ADD CONSTRAINT "AdImpression_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "AdNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_payoutRequestId_fkey" FOREIGN KEY ("payoutRequestId") REFERENCES "PayoutRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmcaTarget" ADD CONSTRAINT "DmcaTarget_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "DmcaNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmcaTarget" ADD CONSTRAINT "DmcaTarget_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterNotice" ADD CONSTRAINT "CounterNotice_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "DmcaNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterNotice" ADD CONSTRAINT "CounterNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strike" ADD CONSTRAINT "Strike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strike" ADD CONSTRAINT "Strike_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strike" ADD CONSTRAINT "Strike_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "DmcaNotice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbuseReport" ADD CONSTRAINT "AbuseReport_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
