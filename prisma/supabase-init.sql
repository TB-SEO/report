-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AdDeviceType" AS ENUM ('ALL', 'PC', 'MOBILE');

-- CreateEnum
CREATE TYPE "BlogTrafficCategory" AS ENUM ('SEARCH', 'SNS', 'OTHER');

-- CreateEnum
CREATE TYPE "BlogDeviceType" AS ENUM ('MOBILE', 'PC');

-- CreateEnum
CREATE TYPE "IngestSource" AS ENUM ('NAVER_ADS', 'NAVER_BLOG', 'TISTORY_BLOG', 'VELOG', 'BRUNCH', 'KEYWORD_TOOL');

-- CreateEnum
CREATE TYPE "BlogPlatform" AS ENUM ('TISTORY', 'NAVER', 'VELOG', 'BRUNCH');

-- CreateEnum
CREATE TYPE "IngestStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_batches" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "source" "IngestSource" NOT NULL,
    "status" "IngestStatus" NOT NULL DEFAULT 'PENDING',
    "period_start" DATE,
    "period_end" DATE,
    "note" TEXT,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "naver_ad_accounts" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credential_ref" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "naver_ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "naver_business_channels" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "ncc_channel_id" TEXT NOT NULL,
    "name" TEXT,
    "site_url" TEXT,
    "channel_type" TEXT,
    "inspect_status" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "raw_json" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "naver_business_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "naver_ad_campaigns" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "ncc_campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaign_type" TEXT NOT NULL,
    "user_lock" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT,
    "status_reason" TEXT,
    "delivery_method" TEXT,
    "daily_budget" BIGINT,
    "use_daily_budget" BOOLEAN,
    "use_period" BOOLEAN,
    "period_start" DATE,
    "period_end" DATE,
    "tracking_mode" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "registered_at" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "raw_json" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "naver_ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "naver_ad_groups" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "ncc_adgroup_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "user_lock" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT,
    "status_reason" TEXT,
    "bid_amt" BIGINT,
    "daily_budget" BIGINT,
    "pc_channel_id" TEXT,
    "mobile_channel_id" TEXT,
    "pc_channel_url" TEXT,
    "mobile_channel_url" TEXT,
    "pc_channel_status" TEXT,
    "mobile_channel_status" TEXT,
    "contents_network_bid_amt" BIGINT,
    "use_contents_network_bid" BOOLEAN,
    "pc_network_bid_weight" INTEGER,
    "mobile_network_bid_weight" INTEGER,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "registered_at" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "raw_json" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "naver_ad_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "naver_ad_keywords" (
    "id" TEXT NOT NULL,
    "ad_group_id" TEXT NOT NULL,
    "ncc_keyword_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "bid_amt" BIGINT,
    "user_lock" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT,
    "inspect_status" TEXT,
    "pc_url" TEXT,
    "mobile_url" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "registered_at" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "raw_json" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "naver_ad_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "naver_ads" (
    "id" TEXT NOT NULL,
    "ad_group_id" TEXT NOT NULL,
    "ncc_ad_id" TEXT NOT NULL,
    "ad_type" TEXT,
    "headline" TEXT,
    "description" TEXT,
    "inspect_status" TEXT,
    "user_lock" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "registered_at" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "raw_json" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "naver_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "naver_campaign_stats_daily" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "device_type" "AdDeviceType" NOT NULL DEFAULT 'ALL',
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ctr" DECIMAL(10,6),
    "cpc" DECIMAL(18,4),
    "avg_rank" DECIMAL(10,4),
    "conversions" DECIMAL(18,4),
    "conversion_rate" DECIMAL(10,6),
    "conversion_value" DECIMAL(18,4),
    "roas_pct" DECIMAL(18,4),
    "view_cnt" BIGINT,
    "cost_per_conversion" DECIMAL(18,4),
    "recent_avg_rank" DECIMAL(10,4),
    "recent_avg_cpc" DECIMAL(18,4),
    "pc_nx_avg_rank" DECIMAL(10,4),
    "mbl_nx_avg_rank" DECIMAL(10,4),
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "naver_campaign_stats_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "naver_adgroup_stats_daily" (
    "id" TEXT NOT NULL,
    "ad_group_id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "device_type" "AdDeviceType" NOT NULL DEFAULT 'ALL',
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ctr" DECIMAL(10,6),
    "cpc" DECIMAL(18,4),
    "avg_rank" DECIMAL(10,4),
    "conversions" DECIMAL(18,4),
    "conversion_rate" DECIMAL(10,6),
    "conversion_value" DECIMAL(18,4),
    "roas_pct" DECIMAL(18,4),
    "view_cnt" BIGINT,
    "cost_per_conversion" DECIMAL(18,4),
    "recent_avg_rank" DECIMAL(10,4),
    "recent_avg_cpc" DECIMAL(18,4),
    "pc_nx_avg_rank" DECIMAL(10,4),
    "mbl_nx_avg_rank" DECIMAL(10,4),
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "naver_adgroup_stats_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "naver_keyword_stats_daily" (
    "id" TEXT NOT NULL,
    "keyword_id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "device_type" "AdDeviceType" NOT NULL DEFAULT 'ALL',
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ctr" DECIMAL(10,6),
    "cpc" DECIMAL(18,4),
    "avg_rank" DECIMAL(10,4),
    "conversions" DECIMAL(18,4),
    "conversion_rate" DECIMAL(10,6),
    "conversion_value" DECIMAL(18,4),
    "roas_pct" DECIMAL(18,4),
    "view_cnt" BIGINT,
    "cost_per_conversion" DECIMAL(18,4),
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "naver_keyword_stats_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "naver_ad_stats_daily" (
    "id" TEXT NOT NULL,
    "ad_id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "device_type" "AdDeviceType" NOT NULL DEFAULT 'ALL',
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ctr" DECIMAL(10,6),
    "cpc" DECIMAL(18,4),
    "avg_rank" DECIMAL(10,4),
    "conversions" DECIMAL(18,4),
    "conversion_rate" DECIMAL(10,6),
    "conversion_value" DECIMAL(18,4),
    "roas_pct" DECIMAL(18,4),
    "view_cnt" BIGINT,
    "cost_per_conversion" DECIMAL(18,4),
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "naver_ad_stats_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "naver_search_term_stats_daily" (
    "id" TEXT NOT NULL,
    "ad_group_id" TEXT,
    "ncc_campaign_id" TEXT NOT NULL DEFAULT '',
    "ncc_adgroup_id" TEXT NOT NULL DEFAULT '',
    "ncc_keyword_id" TEXT NOT NULL DEFAULT '',
    "search_term" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "device_type" "AdDeviceType" NOT NULL DEFAULT 'ALL',
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "naver_search_term_stats_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_insights" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "collected_date" DATE NOT NULL,
    "monthly_pc_qc_cnt" BIGINT,
    "monthly_mobile_qc_cnt" BIGINT,
    "monthly_ave_pc_clk_cnt" DECIMAL(18,4),
    "monthly_ave_mobile_clk_cnt" DECIMAL(18,4),
    "monthly_ave_pc_ctr" DECIMAL(10,6),
    "monthly_ave_mobile_ctr" DECIMAL(10,6),
    "competition" TEXT,
    "pl_avg_depth" DECIMAL(10,4),
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blogs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "platform" "BlogPlatform" NOT NULL,
    "blog_user_id" TEXT NOT NULL,
    "name" TEXT,
    "url" TEXT,
    "subscriber_count" INTEGER,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" TEXT NOT NULL,
    "blog_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT,
    "url" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_post_stats_daily" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "views" BIGINT NOT NULL DEFAULT 0,
    "likes" BIGINT,
    "comments" BIGINT,
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_post_stats_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_stats_daily" (
    "id" TEXT NOT NULL,
    "blog_id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "views" BIGINT NOT NULL DEFAULT 0,
    "visitors" BIGINT NOT NULL DEFAULT 0,
    "visits" BIGINT,
    "avg_duration_seconds" DECIMAL(12,2),
    "revisit_rate" DECIMAL(10,6),
    "subscriber_count" INTEGER,
    "cumulative_views" BIGINT,
    "cumulative_visitors" BIGINT,
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_stats_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_stats_hourly" (
    "id" TEXT NOT NULL,
    "blog_id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "hour" INTEGER NOT NULL,
    "views" BIGINT NOT NULL DEFAULT 0,
    "visitors" BIGINT NOT NULL DEFAULT 0,
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_stats_hourly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_traffic_sources_daily" (
    "id" TEXT NOT NULL,
    "blog_id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "category" "BlogTrafficCategory" NOT NULL,
    "source_code" TEXT NOT NULL,
    "source_name" TEXT,
    "views" BIGINT NOT NULL DEFAULT 0,
    "visitors" BIGINT,
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_traffic_sources_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_device_stats_daily" (
    "id" TEXT NOT NULL,
    "blog_id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "device_type" "BlogDeviceType" NOT NULL,
    "views" BIGINT NOT NULL DEFAULT 0,
    "visitors" BIGINT,
    "share_pct" DECIMAL(7,4),
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_device_stats_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_popular_posts_daily" (
    "id" TEXT NOT NULL,
    "blog_id" TEXT NOT NULL,
    "post_id" TEXT,
    "stat_date" DATE NOT NULL,
    "rank" INTEGER NOT NULL,
    "title" TEXT,
    "url" TEXT,
    "views" BIGINT NOT NULL DEFAULT 0,
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_popular_posts_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_inflow_keywords_daily" (
    "id" TEXT NOT NULL,
    "blog_id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "keyword" TEXT NOT NULL,
    "rank" INTEGER,
    "views" BIGINT NOT NULL DEFAULT 0,
    "visitors" BIGINT,
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_inflow_keywords_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_demographics_daily" (
    "id" TEXT NOT NULL,
    "blog_id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "gender" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "age_group" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "views" BIGINT NOT NULL DEFAULT 0,
    "visitors" BIGINT,
    "share_pct" DECIMAL(7,4),
    "raw_json" JSONB,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_demographics_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_slug_key" ON "clients"("slug");

-- CreateIndex
CREATE INDEX "ingest_batches_client_id_source_created_at_idx" ON "ingest_batches"("client_id", "source", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "naver_ad_accounts_customer_id_key" ON "naver_ad_accounts"("customer_id");

-- CreateIndex
CREATE INDEX "naver_ad_accounts_client_id_idx" ON "naver_ad_accounts"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "naver_business_channels_ncc_channel_id_key" ON "naver_business_channels"("ncc_channel_id");

-- CreateIndex
CREATE INDEX "naver_business_channels_account_id_idx" ON "naver_business_channels"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "naver_ad_campaigns_ncc_campaign_id_key" ON "naver_ad_campaigns"("ncc_campaign_id");

-- CreateIndex
CREATE INDEX "naver_ad_campaigns_account_id_is_deleted_idx" ON "naver_ad_campaigns"("account_id", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "naver_ad_groups_ncc_adgroup_id_key" ON "naver_ad_groups"("ncc_adgroup_id");

-- CreateIndex
CREATE INDEX "naver_ad_groups_campaign_id_is_deleted_idx" ON "naver_ad_groups"("campaign_id", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "naver_ad_keywords_ncc_keyword_id_key" ON "naver_ad_keywords"("ncc_keyword_id");

-- CreateIndex
CREATE INDEX "naver_ad_keywords_ad_group_id_is_deleted_idx" ON "naver_ad_keywords"("ad_group_id", "is_deleted");

-- CreateIndex
CREATE INDEX "naver_ad_keywords_keyword_idx" ON "naver_ad_keywords"("keyword");

-- CreateIndex
CREATE UNIQUE INDEX "naver_ads_ncc_ad_id_key" ON "naver_ads"("ncc_ad_id");

-- CreateIndex
CREATE INDEX "naver_ads_ad_group_id_is_deleted_idx" ON "naver_ads"("ad_group_id", "is_deleted");

-- CreateIndex
CREATE INDEX "naver_campaign_stats_daily_stat_date_idx" ON "naver_campaign_stats_daily"("stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "naver_campaign_stats_daily_campaign_id_stat_date_device_typ_key" ON "naver_campaign_stats_daily"("campaign_id", "stat_date", "device_type");

-- CreateIndex
CREATE INDEX "naver_adgroup_stats_daily_stat_date_idx" ON "naver_adgroup_stats_daily"("stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "naver_adgroup_stats_daily_ad_group_id_stat_date_device_type_key" ON "naver_adgroup_stats_daily"("ad_group_id", "stat_date", "device_type");

-- CreateIndex
CREATE INDEX "naver_keyword_stats_daily_stat_date_idx" ON "naver_keyword_stats_daily"("stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "naver_keyword_stats_daily_keyword_id_stat_date_device_type_key" ON "naver_keyword_stats_daily"("keyword_id", "stat_date", "device_type");

-- CreateIndex
CREATE INDEX "naver_ad_stats_daily_stat_date_idx" ON "naver_ad_stats_daily"("stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "naver_ad_stats_daily_ad_id_stat_date_device_type_key" ON "naver_ad_stats_daily"("ad_id", "stat_date", "device_type");

-- CreateIndex
CREATE INDEX "naver_search_term_stats_daily_stat_date_idx" ON "naver_search_term_stats_daily"("stat_date");

-- CreateIndex
CREATE INDEX "naver_search_term_stats_daily_search_term_idx" ON "naver_search_term_stats_daily"("search_term");

-- CreateIndex
CREATE UNIQUE INDEX "naver_search_term_stats_daily_ncc_adgroup_id_search_term_st_key" ON "naver_search_term_stats_daily"("ncc_adgroup_id", "search_term", "stat_date", "device_type");

-- CreateIndex
CREATE INDEX "keyword_insights_keyword_idx" ON "keyword_insights"("keyword");

-- CreateIndex
CREATE UNIQUE INDEX "keyword_insights_client_id_keyword_collected_date_key" ON "keyword_insights"("client_id", "keyword", "collected_date");

-- CreateIndex
CREATE INDEX "blogs_client_id_idx" ON "blogs"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "blogs_platform_blog_user_id_key" ON "blogs"("platform", "blog_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_blog_id_external_id_key" ON "blog_posts"("blog_id", "external_id");

-- CreateIndex
CREATE INDEX "blog_post_stats_daily_stat_date_idx" ON "blog_post_stats_daily"("stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "blog_post_stats_daily_post_id_stat_date_key" ON "blog_post_stats_daily"("post_id", "stat_date");

-- CreateIndex
CREATE INDEX "blog_stats_daily_stat_date_idx" ON "blog_stats_daily"("stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "blog_stats_daily_blog_id_stat_date_key" ON "blog_stats_daily"("blog_id", "stat_date");

-- CreateIndex
CREATE INDEX "blog_stats_hourly_stat_date_idx" ON "blog_stats_hourly"("stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "blog_stats_hourly_blog_id_stat_date_hour_key" ON "blog_stats_hourly"("blog_id", "stat_date", "hour");

-- CreateIndex
CREATE INDEX "blog_traffic_sources_daily_stat_date_idx" ON "blog_traffic_sources_daily"("stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "blog_traffic_sources_daily_blog_id_stat_date_category_sourc_key" ON "blog_traffic_sources_daily"("blog_id", "stat_date", "category", "source_code");

-- CreateIndex
CREATE UNIQUE INDEX "blog_device_stats_daily_blog_id_stat_date_device_type_key" ON "blog_device_stats_daily"("blog_id", "stat_date", "device_type");

-- CreateIndex
CREATE INDEX "blog_popular_posts_daily_stat_date_idx" ON "blog_popular_posts_daily"("stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "blog_popular_posts_daily_blog_id_stat_date_rank_key" ON "blog_popular_posts_daily"("blog_id", "stat_date", "rank");

-- CreateIndex
CREATE INDEX "blog_inflow_keywords_daily_keyword_idx" ON "blog_inflow_keywords_daily"("keyword");

-- CreateIndex
CREATE INDEX "blog_inflow_keywords_daily_stat_date_idx" ON "blog_inflow_keywords_daily"("stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "blog_inflow_keywords_daily_blog_id_stat_date_keyword_key" ON "blog_inflow_keywords_daily"("blog_id", "stat_date", "keyword");

-- CreateIndex
CREATE INDEX "blog_demographics_daily_stat_date_idx" ON "blog_demographics_daily"("stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "blog_demographics_daily_blog_id_stat_date_gender_age_group_key" ON "blog_demographics_daily"("blog_id", "stat_date", "gender", "age_group");

-- AddForeignKey
ALTER TABLE "ingest_batches" ADD CONSTRAINT "ingest_batches_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "naver_ad_accounts" ADD CONSTRAINT "naver_ad_accounts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "naver_business_channels" ADD CONSTRAINT "naver_business_channels_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "naver_ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "naver_ad_campaigns" ADD CONSTRAINT "naver_ad_campaigns_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "naver_ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "naver_ad_groups" ADD CONSTRAINT "naver_ad_groups_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "naver_ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "naver_ad_keywords" ADD CONSTRAINT "naver_ad_keywords_ad_group_id_fkey" FOREIGN KEY ("ad_group_id") REFERENCES "naver_ad_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "naver_ads" ADD CONSTRAINT "naver_ads_ad_group_id_fkey" FOREIGN KEY ("ad_group_id") REFERENCES "naver_ad_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "naver_campaign_stats_daily" ADD CONSTRAINT "naver_campaign_stats_daily_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "naver_ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "naver_adgroup_stats_daily" ADD CONSTRAINT "naver_adgroup_stats_daily_ad_group_id_fkey" FOREIGN KEY ("ad_group_id") REFERENCES "naver_ad_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "naver_keyword_stats_daily" ADD CONSTRAINT "naver_keyword_stats_daily_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "naver_ad_keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "naver_ad_stats_daily" ADD CONSTRAINT "naver_ad_stats_daily_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "naver_ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_insights" ADD CONSTRAINT "keyword_insights_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blogs" ADD CONSTRAINT "blogs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_post_stats_daily" ADD CONSTRAINT "blog_post_stats_daily_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_stats_daily" ADD CONSTRAINT "blog_stats_daily_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_stats_hourly" ADD CONSTRAINT "blog_stats_hourly_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_traffic_sources_daily" ADD CONSTRAINT "blog_traffic_sources_daily_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_device_stats_daily" ADD CONSTRAINT "blog_device_stats_daily_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_popular_posts_daily" ADD CONSTRAINT "blog_popular_posts_daily_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_popular_posts_daily" ADD CONSTRAINT "blog_popular_posts_daily_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "blog_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_inflow_keywords_daily" ADD CONSTRAINT "blog_inflow_keywords_daily_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_demographics_daily" ADD CONSTRAINT "blog_demographics_daily_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';

