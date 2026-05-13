-- TKT-00260: Add customer_display_email column to order_attributions
-- This stores masked email (e.g. j***@gmail.com) for UI display
-- without exposing the full plaintext email.

ALTER TABLE order_attributions
ADD COLUMN IF NOT EXISTS customer_display_email TEXT;

COMMENT ON COLUMN order_attributions.customer_display_email 
IS 'Masked email for UI display, e.g. j***@gmail.com. Set at attribution time.';
