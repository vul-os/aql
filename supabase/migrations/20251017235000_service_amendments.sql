-- =====================================================
-- Service Amendments Table
-- Tracks requests to modify services (add/remove gardens)
-- Requires admin approval before taking effect
-- =====================================================

CREATE TABLE service_amendments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Amendment details
    amendment_type TEXT NOT NULL CHECK (amendment_type IN ('add_gardens', 'remove_gardens', 'change_frequency')),
    current_garden_count INTEGER,
    new_garden_count INTEGER,
    current_frequency TEXT,
    new_frequency TEXT,
    
    -- Status and approval
    status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
        'pending_approval', 'approved', 'rejected', 'implemented', 'cancelled'
    )),
    approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    
    -- Signature
    signature_url TEXT,
    signature_ip_address TEXT,
    signature_user_agent TEXT,
    signed_at TIMESTAMPTZ,
    
    -- Implementation
    implemented_at TIMESTAMPTZ,
    implementation_notes TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_service_amendments_service_id ON service_amendments(service_id);
CREATE INDEX IF NOT EXISTS idx_service_amendments_user_id ON service_amendments(user_id);
CREATE INDEX IF NOT EXISTS idx_service_amendments_status ON service_amendments(status);
CREATE INDEX IF NOT EXISTS idx_service_amendments_created_at ON service_amendments(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER update_service_amendments_updated_at 
    BEFORE UPDATE ON service_amendments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS disabled (will use policies later)
ALTER TABLE service_amendments DISABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE service_amendments IS 'Tracks service modification requests requiring admin approval';
COMMENT ON COLUMN service_amendments.amendment_type IS 'Type of amendment: add_gardens, remove_gardens, or change_frequency';
COMMENT ON COLUMN service_amendments.status IS 'Current status: pending_approval, approved, rejected, implemented, or cancelled';
COMMENT ON COLUMN service_amendments.approved_by IS 'Admin who approved the amendment';
COMMENT ON COLUMN service_amendments.signature_url IS 'User signature confirming the amendment request';

