ALTER TABLE "rooms" ADD COLUMN "target_score" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "with_flor" boolean DEFAULT true NOT NULL;