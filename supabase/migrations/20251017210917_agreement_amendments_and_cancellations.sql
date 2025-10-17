-- =====================================================
-- Rental Agreement Amendments & Cancellation Requests
-- =====================================================
-- Handles changes to active agreements and cancellation workflow

-- =====================================================
-- RENTAL AGREEMENT AMENDMENTS
-- =====================================================
-- Track changes to rental agreements (adding gardens, changing pricing, etc.)

CREATE TABLE IF NOT EXISTS rental_agreement_amendments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rental_agreement_id UUID NOT NULL REFERENCES rental_agreements(id) ON DELETE CASCADE,
    
    -- Amendment details
    amendment_number TEXT UNIQUE NOT NULL, -- e.g., "AMD-2025-001234"
    amendment_type TEXT NOT NULL CHECK (amendment_type IN ('add_garden', 'remove_garden', 'change_pricing', 'change_billing_day', 'change_service_frequency')),
    
    -- Previous values (for audit trail)
    previous_number_of_bots INTEGER,
    previous_services_per_month INTEGER,
    previous_monthly_total DECIMAL(10, 2),
    previous_billing_day INTEGER,
    
    -- New values
    new_number_of_bots INTEGER,
    new_services_per_month INTEGER,
    new_monthly_total DECIMAL(10, 2),
    new_billing_day INTEGER,
    
    -- Change details
    description TEXT NOT NULL,
    reason TEXT,
    
    -- Gardens affected
    gardens_added UUID[], -- Array of garden IDs added
    gardens_removed UUID[], -- Array of garden IDs removed
    
    -- Pricing impact
    monthly_difference DECIMAL(10, 2) DEFAULT 0, -- Difference in monthly charges
    prorated_amount DECIMAL(10, 2) DEFAULT 0, -- Pro-rated amount for current month
    
    -- Status and dates
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'active', 'rejected')),
    effective_date DATE NOT NULL, -- When this amendment takes effect
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES profiles(id),
    
    -- Document
    amendment_pdf_url TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- SERVICE CANCELLATION REQUESTS
-- =====================================================
-- Approval workflow for service cancellations

CREATE TABLE IF NOT EXISTS service_cancellation_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Service reference
    service_id UUID NOT NULL, -- garden_id or pool_id
    service_type TEXT NOT NULL CHECK (service_type IN ('garden', 'pool', 'security', 'weather')),
    service_name TEXT NOT NULL,
    location_id UUID NOT NULL REFERENCES locations(id),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    rental_agreement_id UUID REFERENCES rental_agreements(id),
    
    -- Request details
    request_number TEXT UNIQUE NOT NULL, -- e.g., "CANC-2025-001234"
    requested_by UUID NOT NULL REFERENCES profiles(id),
    cancellation_type TEXT NOT NULL CHECK (cancellation_type IN ('full_service', 'single_garden', 'pause_to_cancel')),
    
    -- Reason and details
    reason TEXT NOT NULL,
    detailed_explanation TEXT,
    preferred_collection_date DATE,
    
    -- Financial impact
    remaining_bots INTEGER DEFAULT 0, -- Bots that will remain after this cancellation
    refund_amount DECIMAL(10, 2) DEFAULT 0, -- Deposit refund due
    final_invoice_amount DECIMAL(10, 2) DEFAULT 0, -- Any final charges
    
    -- Approval workflow
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', -- Awaiting review
        'approved', -- Approved by admin
        'scheduled', -- Bot collection scheduled
        'collected', -- Bot collected
        'completed', -- Cancellation complete, refund issued
        'rejected' -- Request rejected
    )),
    
    -- Workflow tracking
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES profiles(id),
    review_notes TEXT,
    
    collection_scheduled_date DATE,
    collection_completed_date DATE,
    collection_notes TEXT,
    
    refund_processed_date DATE,
    refund_reference TEXT,
    
    -- Documents
    cancellation_confirmation_pdf_url TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_amendments_agreement ON rental_agreement_amendments(rental_agreement_id);
CREATE INDEX IF NOT EXISTS idx_amendments_status ON rental_agreement_amendments(status);
CREATE INDEX IF NOT EXISTS idx_amendments_effective_date ON rental_agreement_amendments(effective_date);

CREATE INDEX IF NOT EXISTS idx_cancellations_service ON service_cancellation_requests(service_id, service_type);
CREATE INDEX IF NOT EXISTS idx_cancellations_org ON service_cancellation_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_cancellations_status ON service_cancellation_requests(status);
CREATE INDEX IF NOT EXISTS idx_cancellations_requested_by ON service_cancellation_requests(requested_by);

-- =====================================================
-- RLS
-- =====================================================

ALTER TABLE rental_agreement_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_cancellation_requests ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to add garden to existing rental agreement
CREATE OR REPLACE FUNCTION add_garden_to_agreement(
    p_rental_agreement_id UUID,
    p_garden_id UUID,
    p_garden_area_sqm INTEGER,
    p_user_id UUID
)
RETURNS TABLE(
    amendment_id UUID,
    new_monthly_total DECIMAL,
    prorated_amount DECIMAL
) AS $$
DECLARE
    v_agreement RECORD;
    v_pricing RECORD;
    v_amendment_id UUID;
    v_new_bots INTEGER;
    v_new_monthly_total DECIMAL;
    v_prorated_amount DECIMAL;
    v_days_remaining INTEGER;
BEGIN
    -- Get current agreement
    SELECT * INTO v_agreement
    FROM rental_agreements
    WHERE id = p_rental_agreement_id AND status = 'active';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active rental agreement not found';
    END IF;
    
    -- Get current pricing
    SELECT * INTO v_pricing
    FROM pricing_structure
    WHERE bot_type = v_agreement.bot_type AND is_active = true
    LIMIT 1;
    
    -- Calculate new totals (1 bot = 1 garden)
    v_new_bots := v_agreement.number_of_bots + 1;
    v_new_monthly_total := (v_new_bots * v_pricing.bot_rental_monthly) + 
                           (v_agreement.services_per_month * v_pricing.service_price_per_visit);
    
    -- Calculate prorated amount for current month
    v_days_remaining := EXTRACT(DAY FROM (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - CURRENT_DATE));
    v_prorated_amount := ((v_new_monthly_total - v_agreement.monthly_total) / 30) * v_days_remaining;
    
    -- Create amendment
    INSERT INTO rental_agreement_amendments (
        rental_agreement_id,
        amendment_number,
        amendment_type,
        description,
        previous_number_of_bots,
        previous_monthly_total,
        new_number_of_bots,
        new_monthly_total,
        monthly_difference,
        prorated_amount,
        gardens_added,
        effective_date,
        status
    ) VALUES (
        p_rental_agreement_id,
        'AMD-' || EXTRACT(YEAR FROM NOW()) || '-' || FLOOR(RANDOM() * 1000000),
        'add_garden',
        'Added new garden (Area: ' || p_garden_area_sqm || ' m²)',
        v_agreement.number_of_bots,
        v_agreement.monthly_total,
        v_new_bots,
        v_new_monthly_total,
        v_new_monthly_total - v_agreement.monthly_total,
        v_prorated_amount,
        ARRAY[p_garden_id],
        CURRENT_DATE,
        'approved' -- Auto-approve for now
    ) RETURNING id INTO v_amendment_id;
    
    -- Update rental agreement
    UPDATE rental_agreements
    SET 
        number_of_bots = v_new_bots,
        monthly_total = v_new_monthly_total,
        bot_rental_total = v_new_bots * v_pricing.bot_rental_monthly,
        updated_at = NOW()
    WHERE id = p_rental_agreement_id;
    
    RETURN QUERY SELECT v_amendment_id, v_new_monthly_total, v_prorated_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to request service cancellation
CREATE OR REPLACE FUNCTION request_service_cancellation(
    p_service_id UUID,
    p_service_type TEXT,
    p_service_name TEXT,
    p_location_id UUID,
    p_organization_id UUID,
    p_rental_agreement_id UUID,
    p_requested_by UUID,
    p_cancellation_type TEXT,
    p_reason TEXT,
    p_detailed_explanation TEXT DEFAULT NULL,
    p_preferred_collection_date DATE DEFAULT NULL
)
RETURNS TABLE(
    request_id UUID,
    request_number TEXT,
    estimated_refund DECIMAL
) AS $$
DECLARE
    v_request_id UUID;
    v_request_number TEXT;
    v_refund_amount DECIMAL := 0;
    v_remaining_bots INTEGER;
BEGIN
    -- Generate request number
    v_request_number := 'CANC-' || EXTRACT(YEAR FROM NOW()) || '-' || LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    
    -- Calculate refund (deposit per bot being cancelled)
    -- Assuming R299 setup fee per bot (could query pricing_structure)
    v_refund_amount := 299.00; -- Will be calculated properly based on actual deposits
    
    -- Calculate remaining bots
    IF p_cancellation_type = 'full_service' THEN
        v_remaining_bots := 0;
    ELSE
        -- Get current bot count and subtract 1
        SELECT number_of_bots - 1 INTO v_remaining_bots
        FROM rental_agreements
        WHERE id = p_rental_agreement_id;
    END IF;
    
    -- Create cancellation request
    INSERT INTO service_cancellation_requests (
        service_id,
        service_type,
        service_name,
        location_id,
        organization_id,
        rental_agreement_id,
        requested_by,
        cancellation_type,
        request_number,
        reason,
        detailed_explanation,
        preferred_collection_date,
        remaining_bots,
        refund_amount,
        status
    ) VALUES (
        p_service_id,
        p_service_type,
        p_service_name,
        p_location_id,
        p_organization_id,
        p_rental_agreement_id,
        p_requested_by,
        p_cancellation_type,
        v_request_number,
        p_reason,
        p_detailed_explanation,
        p_preferred_collection_date,
        v_remaining_bots,
        v_refund_amount,
        'pending'
    ) RETURNING id INTO v_request_id;
    
    RETURN QUERY SELECT v_request_id, v_request_number, v_refund_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to approve cancellation request
CREATE OR REPLACE FUNCTION approve_cancellation_request(
    p_request_id UUID,
    p_reviewed_by UUID,
    p_review_notes TEXT DEFAULT NULL,
    p_collection_date DATE DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_request RECORD;
BEGIN
    -- Get request details
    SELECT * INTO v_request
    FROM service_cancellation_requests
    WHERE id = p_request_id AND status = 'pending';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cancellation request not found or already processed';
    END IF;
    
    -- Update request status
    UPDATE service_cancellation_requests
    SET 
        status = 'approved',
        reviewed_at = NOW(),
        reviewed_by = p_reviewed_by,
        review_notes = p_review_notes,
        collection_scheduled_date = COALESCE(p_collection_date, preferred_collection_date, CURRENT_DATE + 7)
    WHERE id = p_request_id;
    
    -- Mark service as pending cancellation (don't delete yet)
    IF v_request.service_type = 'garden' THEN
        UPDATE gardens
        SET 
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cancellation_pending', true, 'cancellation_request_id', p_request_id)
        WHERE id = v_request.service_id;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to complete cancellation (after bot collection)
CREATE OR REPLACE FUNCTION complete_cancellation(
    p_request_id UUID,
    p_completed_by UUID,
    p_collection_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_request RECORD;
BEGIN
    -- Get request details
    SELECT * INTO v_request
    FROM service_cancellation_requests
    WHERE id = p_request_id AND status = 'approved';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Approved cancellation request not found';
    END IF;
    
    -- Update request status
    UPDATE service_cancellation_requests
    SET 
        status = 'completed',
        collection_completed_date = CURRENT_DATE,
        collection_notes = p_collection_notes,
        refund_processed_date = CURRENT_DATE
    WHERE id = p_request_id;
    
    -- Cancel the service
    IF v_request.service_type = 'garden' THEN
        UPDATE gardens
        SET 
            is_active = false,
            cancelled_at = NOW(),
            cancellation_reason = 'Approved cancellation request: ' || v_request.request_number
        WHERE id = v_request.service_id;
    END IF;
    
    -- Update rental agreement if full cancellation
    IF v_request.cancellation_type = 'full_service' THEN
        UPDATE rental_agreements
        SET 
            status = 'cancelled',
            cancelled_at = NOW(),
            cancellation_reason = 'Service cancellation request approved'
        WHERE id = v_request.rental_agreement_id;
    ELSE
        -- Update rental agreement to reflect reduced bots
        UPDATE rental_agreements
        SET 
            number_of_bots = v_request.remaining_bots,
            updated_at = NOW()
        WHERE id = v_request.rental_agreement_id;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

GRANT EXECUTE ON FUNCTION add_garden_to_agreement TO authenticated;
GRANT EXECUTE ON FUNCTION request_service_cancellation TO authenticated;
GRANT EXECUTE ON FUNCTION approve_cancellation_request TO authenticated;
GRANT EXECUTE ON FUNCTION complete_cancellation TO authenticated;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE rental_agreement_amendments IS 'Tracks all changes to rental agreements (adding/removing services, pricing changes)';
COMMENT ON TABLE service_cancellation_requests IS 'Approval workflow for service cancellations with bot collection coordination';

COMMENT ON FUNCTION add_garden_to_agreement IS 'Add a new garden to an existing rental agreement, calculates new pricing and prorated charges';
COMMENT ON FUNCTION request_service_cancellation IS 'Create a cancellation request that requires approval';
COMMENT ON FUNCTION approve_cancellation_request IS 'Approve a cancellation request and schedule bot collection';
COMMENT ON FUNCTION complete_cancellation IS 'Mark cancellation as complete after bot collection, process refund, update billing';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Created rental_agreement_amendments and service_cancellation_requests tables';
    RAISE NOTICE 'Created functions: add_garden_to_agreement, request_service_cancellation, approve_cancellation_request, complete_cancellation';
END $$;

