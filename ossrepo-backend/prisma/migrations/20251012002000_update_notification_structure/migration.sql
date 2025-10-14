-- Update notification structure to support multiple channels
-- First, add the new JSON columns
ALTER TABLE "public"."projects" ADD COLUMN "vulnerability_notifications" JSONB;
ALTER TABLE "public"."projects" ADD COLUMN "license_notifications" JSONB;
ALTER TABLE "public"."projects" ADD COLUMN "health_notifications" JSONB;

-- Migrate existing boolean values to JSON structure
UPDATE "public"."projects" 
SET 
  "vulnerability_notifications" = CASE 
    WHEN "vulnerability_alerts" = true THEN '{"alerts": true, "slack": false, "discord": false}'::jsonb
    ELSE '{"alerts": false, "slack": false, "discord": false}'::jsonb
  END,
  "license_notifications" = CASE 
    WHEN "license_alerts" = true THEN '{"alerts": true, "slack": false, "discord": false}'::jsonb
    ELSE '{"alerts": false, "slack": false, "discord": false}'::jsonb
  END,
  "health_notifications" = CASE 
    WHEN "health_alerts" = true THEN '{"alerts": true, "slack": false, "discord": false}'::jsonb
    ELSE '{"alerts": false, "slack": false, "discord": false}'::jsonb
  END;

-- Drop the old boolean columns
ALTER TABLE "public"."projects" DROP COLUMN "vulnerability_alerts";
ALTER TABLE "public"."projects" DROP COLUMN "license_alerts";
ALTER TABLE "public"."projects" DROP COLUMN "health_alerts";
