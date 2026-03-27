-- Add CLAIMING status to payout_item_status enum.
-- This enables atomic claim-before-send to prevent double-payment:
-- Only one process can UPDATE status from PENDING to CLAIMING;
-- the others will find no PENDING rows to claim.

ALTER TYPE payout_item_status ADD VALUE IF NOT EXISTS 'CLAIMING' AFTER 'PENDING';
