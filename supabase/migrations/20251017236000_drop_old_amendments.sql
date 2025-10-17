-- =====================================================
-- Drop Old Rental Agreement Amendments Table
-- Replaced by simpler service_amendments table
-- =====================================================

-- Drop the old amendments table (not used)
DROP TABLE IF EXISTS rental_agreement_amendments CASCADE;

-- Comment
COMMENT ON TABLE service_amendments IS 'New simplified amendments system - tracks service modifications requiring admin approval';

