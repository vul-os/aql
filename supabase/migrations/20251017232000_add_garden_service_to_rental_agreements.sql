-- =====================================================
-- Add Service and Garden Links to Rental Agreements
-- One rental agreement per garden/bot
-- =====================================================

-- Add service_id column
ALTER TABLE rental_agreements
    ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL;

-- Add garden_id column (for lawn services)
ALTER TABLE rental_agreements
    ADD COLUMN IF NOT EXISTS garden_id UUID REFERENCES gardens(id) ON DELETE SET NULL;

-- Add pool_id column (for pool services) 
ALTER TABLE rental_agreements
    ADD COLUMN IF NOT EXISTS pool_id UUID REFERENCES pools(id) ON DELETE SET NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_rental_agreements_service_id ON rental_agreements(service_id);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_garden_id ON rental_agreements(garden_id);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_pool_id ON rental_agreements(pool_id);

-- Update existing agreements to have 1 bot each (for old data)
-- This is a data migration - existing multi-bot agreements will be updated
UPDATE rental_agreements
SET number_of_bots = 1
WHERE number_of_bots != 1;

-- Now add constraint: Each rental agreement should have exactly 1 bot
ALTER TABLE rental_agreements
    DROP CONSTRAINT IF EXISTS rental_agreements_number_of_bots_check;

ALTER TABLE rental_agreements
    ADD CONSTRAINT rental_agreements_one_bot_per_agreement 
    CHECK (number_of_bots = 1);

-- Comments
COMMENT ON COLUMN rental_agreements.service_id IS 'Links to the service this agreement belongs to';
COMMENT ON COLUMN rental_agreements.garden_id IS 'Links to the specific garden (for lawn services)';
COMMENT ON COLUMN rental_agreements.pool_id IS 'Links to the specific pool (for pool services)';
COMMENT ON CONSTRAINT rental_agreements_one_bot_per_agreement ON rental_agreements IS 'Each rental agreement covers exactly one bot';

