-- =====================================================
-- Master & Bot Rental Agreements
-- =====================================================
-- NEW ARCHITECTURE:
-- - MASTER AGREEMENT: User signs once
-- - BOT RENTAL AGREEMENTS: One per bot (generated from master)
-- =====================================================

-- MASTER RENTAL AGREEMENTS
CREATE TABLE IF NOT EXISTS master_rental_agreements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Master agreement details
    master_agreement_number TEXT UNIQUE NOT NULL,
    
    -- Signature (user signs once for all bots)
    signature_image_url TEXT,
    signature_base64 TEXT,
    signature_ip_address INET,
    signature_user_agent TEXT,
    signed_at TIMESTAMPTZ,
    
    -- Status
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'active', 'cancelled')),
    
    -- Metadata
    terms_version TEXT DEFAULT 'v1.0',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BOT RENTAL AGREEMENTS (One per bot)
CREATE TABLE rental_agreements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Links
    master_agreement_id UUID REFERENCES master_rental_agreements(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    bot_id UUID REFERENCES bots(id) ON DELETE SET NULL,
    garden_id UUID REFERENCES gardens(id) ON DELETE SET NULL,
    
    -- User and organization
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    
    -- Agreement details
    agreement_number TEXT UNIQUE NOT NULL, -- e.g., "RA-2025-001234"
    
    -- Rental details
    bot_type TEXT NOT NULL CHECK (bot_type IN ('mow_bot', 'pool_bot', 'security_bot', 'weather_station')),
    number_of_bots INTEGER NOT NULL DEFAULT 1,
    services_per_month INTEGER NOT NULL DEFAULT 1,
    
    -- Pricing at time of agreement
    monthly_total DECIMAL(10, 2) NOT NULL,
    bot_rental_total DECIMAL(10, 2) NOT NULL,
    service_total DECIMAL(10, 2) NOT NULL,
    setup_fee DECIMAL(10, 2) DEFAULT 0,
    
    -- Legal information (from profile at time of signing)
    signer_first_name TEXT NOT NULL,
    signer_surname TEXT NOT NULL,
    signer_id_number TEXT NOT NULL,
    signer_address TEXT NOT NULL,
    signer_city TEXT NOT NULL,
    signer_province TEXT,
    signer_phone TEXT NOT NULL,
    signer_email TEXT NOT NULL,
    
    -- Signature
    signature_image_url TEXT, -- CDN URL to signature image
    signature_ip_address INET, -- IP address when signed
    signature_user_agent TEXT, -- Browser/device info
    signed_at TIMESTAMPTZ, -- When they signed
    
    -- Agreement document
    agreement_pdf_url TEXT, -- CDN URL to generated PDF
    
    -- Status
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'cancelled')),
    
    -- Flexibility tracking
    started_at TIMESTAMPTZ,
    paused_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    pause_reason TEXT,
    cancellation_reason TEXT,
    
    -- Billing configuration
    billing_day INTEGER DEFAULT 1 CHECK (billing_day >= 1 AND billing_day <= 28),
    next_billing_date DATE,
    prorated_first_charge DECIMAL(10, 2) DEFAULT 0,
    
    -- Metadata
    terms_version TEXT DEFAULT 'v1.0',
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for master agreements
CREATE INDEX IF NOT EXISTS idx_master_agreements_service ON master_rental_agreements(service_id);
CREATE INDEX IF NOT EXISTS idx_master_agreements_user ON master_rental_agreements(user_id);
CREATE INDEX IF NOT EXISTS idx_master_agreements_org ON master_rental_agreements(organization_id);
CREATE INDEX IF NOT EXISTS idx_master_agreements_status ON master_rental_agreements(status);

-- Indexes for rental agreements
CREATE INDEX IF NOT EXISTS idx_rental_agreements_master ON rental_agreements(master_agreement_id);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_service ON rental_agreements(service_id);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_bot ON rental_agreements(bot_id);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_garden ON rental_agreements(garden_id);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_user ON rental_agreements(user_id);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_org ON rental_agreements(organization_id);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_location ON rental_agreements(location_id);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_status ON rental_agreements(status);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_number ON rental_agreements(agreement_number);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_next_billing ON rental_agreements(next_billing_date) WHERE status = 'active';

-- RLS will be disabled in later migration

-- Comments
COMMENT ON TABLE rental_agreements IS 'Flexible rental agreements - no long-term contracts, pause/cancel anytime';
COMMENT ON COLUMN rental_agreements.status IS 'draft: not signed, active: running, paused: temporarily stopped (winter), cancelled: terminated';
COMMENT ON COLUMN rental_agreements.signature_image_url IS 'CDN URL to user signature image';
COMMENT ON COLUMN rental_agreements.agreement_pdf_url IS 'CDN URL to generated agreement PDF';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Rental agreements table created';
    RAISE NOTICE 'Features: No long-term contracts, pause/cancel anytime, winter pause support';
END $$;

