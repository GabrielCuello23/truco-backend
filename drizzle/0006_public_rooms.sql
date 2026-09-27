ALTER TABLE "rooms" ALTER COLUMN "code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "name" varchar(80) DEFAULT 'Sala sin nombre' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;