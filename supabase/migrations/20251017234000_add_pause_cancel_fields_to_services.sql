-- =====================================================
-- Add Pause and Cancel Fields to Services
-- For emergency stop and cancellation functionality
-- =====================================================

-- Add pause-related fields
ALTER TABLE services
    ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT false;

ALTER TABLE services
    ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;

ALTER TABLE services
    ADD COLUMN IF NOT EXISTS paused_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE services
    ADD COLUMN IF NOT EXISTS paused_reason TEXT;

-- Add cancellation fields
ALTER TABLE services
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE services
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_services_is_paused ON services(is_paused);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status) WHERE status IS NOT NULL;

-- Comments
COMMENT ON COLUMN services.is_paused IS 'Whether the service is currently paused (emergency stop)';
COMMENT ON COLUMN services.paused_at IS 'When the service was paused';
COMMENT ON COLUMN services.paused_by IS 'User who paused the service';
COMMENT ON COLUMN services.paused_reason IS 'Reason for pausing the service';
COMMENT ON COLUMN services.cancelled_at IS 'When the service was cancelled';
COMMENT ON COLUMN services.cancellation_reason IS 'Reason for cancellation';

