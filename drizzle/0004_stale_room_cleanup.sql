ALTER TYPE "public"."room_status" ADD VALUE 'abandoned';--> statement-breakpoint
CREATE INDEX "rooms_status_updated_at_idx" ON "rooms" USING btree ("status","updated_at");
