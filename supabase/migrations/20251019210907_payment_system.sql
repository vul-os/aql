-- =====================================================
-- Payment System with Paystack Integration
-- =====================================================

-- PAYMENTS TABLE
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Payment amount
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'ZAR' NOT NULL,
    
    -- Status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'processing', 'completed', 'failed', 
        'cancelled', 'refunded', 'disputed'
    )),
    
    -- Paystack integration fields
    paystack_reference TEXT UNIQUE,
    paystack_authorization_code TEXT,
    paystack_transaction_id BIGINT,
    paystack_access_code TEXT,
    paystack_customer_code TEXT,
    paystack_response JSONB,
    gateway_response TEXT,
    channel TEXT,
    card_type TEXT,
    bank TEXT,
    country_code TEXT DEFAULT 'ZA',
    ip_address TEXT,
    
    -- Payment details
    payment_method TEXT DEFAULT 'paystack' CHECK (payment_method IN ('paystack', 'card', 'bank_transfer', 'cash', 'other')),
    payment_type TEXT CHECK (payment_type IN (
        'subscription', 'setup_fee', 'service_fee', 'top_up', 'other'
    )),
    description TEXT,
    invoice_number TEXT,
    bot_id UUID REFERENCES bots(id) ON DELETE SET NULL,
    subscription_id UUID,
    
    -- Dates
    paid_at TIMESTAMPTZ,
    due_date DATE,
    refunded_at TIMESTAMPTZ,
    
    -- Payer information
    payer_name TEXT,
    payer_email TEXT,
    payer_phone TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PAYMENT_AUTHORIZATIONS TABLE
-- Store card authorizations for recurring payments
CREATE TABLE payment_authorizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Paystack authorization details
    authorization_code TEXT NOT NULL UNIQUE,
    customer_code TEXT NOT NULL,
    
    -- Card details (as provided by Paystack)
    card_type TEXT,
    last4 TEXT NOT NULL,
    exp_month TEXT NOT NULL,
    exp_year TEXT NOT NULL,
    bin TEXT,
    bank TEXT,
    brand TEXT,
    country_code TEXT DEFAULT 'ZA',
    
    -- Authorization metadata
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    reusable BOOLEAN DEFAULT true,
    
    -- Verification
    verified_at TIMESTAMPTZ DEFAULT NOW(),
    verification_amount DECIMAL(10, 2) DEFAULT 1.00,
    
    -- Additional info
    email TEXT,
    signature TEXT,
    channel TEXT,
    
    -- Metadata
    paystack_response JSONB,
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    
    -- Tracking
    last_used_at TIMESTAMPTZ,
    usage_count INTEGER DEFAULT 0,
    failed_attempts INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT unique_user_authorization UNIQUE(user_id, authorization_code)
);

-- PAYMENT_TRANSACTION_LOGS TABLE
-- Detailed log of all payment attempts
CREATE TABLE payment_transaction_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    authorization_id UUID REFERENCES payment_authorizations(id) ON DELETE SET NULL,
    
    -- Transaction details
    reference TEXT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'ZAR',
    status TEXT NOT NULL,
    
    -- Paystack data
    paystack_transaction_id BIGINT,
    gateway_response TEXT,
    channel TEXT,
    
    -- Request/Response
    request_payload JSONB,
    response_payload JSONB,
    
    -- Metadata
    ip_address TEXT,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for payments
CREATE INDEX IF NOT EXISTS idx_payments_organization_id ON payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_paystack_reference ON payments(paystack_reference);
CREATE INDEX IF NOT EXISTS idx_payments_bot_id ON payments(bot_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_due_date ON payments(due_date);
CREATE INDEX IF NOT EXISTS idx_payments_paystack_customer_code ON payments(paystack_customer_code);
CREATE INDEX IF NOT EXISTS idx_payments_paystack_transaction_id ON payments(paystack_transaction_id);

-- Indexes for payment_authorizations
CREATE INDEX IF NOT EXISTS idx_payment_auth_org ON payment_authorizations(organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_auth_user ON payment_authorizations(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_auth_code ON payment_authorizations(authorization_code);
CREATE INDEX IF NOT EXISTS idx_payment_auth_customer ON payment_authorizations(customer_code);
CREATE INDEX IF NOT EXISTS idx_payment_auth_active ON payment_authorizations(is_active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_payment_auth_default ON payment_authorizations(user_id, is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_payment_auth_created ON payment_authorizations(created_at DESC);

-- Indexes for payment_transaction_logs
CREATE INDEX IF NOT EXISTS idx_payment_logs_payment ON payment_transaction_logs(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_auth ON payment_transaction_logs(authorization_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_reference ON payment_transaction_logs(reference);
CREATE INDEX IF NOT EXISTS idx_payment_logs_created ON payment_transaction_logs(created_at DESC);

-- =====================================================
-- DEPOSITS TABLE (R500 per bot)
-- =====================================================

-- Add deposit tracking to bots table
ALTER TABLE bots
    ADD COLUMN IF NOT EXISTS deposit_required DECIMAL(10, 2) DEFAULT 500.00,
    ADD COLUMN IF NOT EXISTS deposit_paid DECIMAL(10, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deposit_refunded DECIMAL(10, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS deposit_refunded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deposit_status TEXT DEFAULT 'pending' 
        CHECK (deposit_status IN ('pending', 'paid', 'partially_paid', 'refunded', 'partially_refunded', 'forfeited'));

-- NOTE: Deposits table has been moved to 20251019211000_referral_system.sql
-- The referral system includes a more comprehensive deposits table with better integration
-- for referral qualification and tracking. The deposits functionality is now part of
-- the referral rewards system where deposits are required and qualify referrals.

-- NOTE: Deposit functions have been moved to 20251019211000_referral_system.sql
-- Use record_deposit_payment() function from the referral system instead
-- The new function includes referral qualification logic and better tracking
-- ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE payment_authorizations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE payment_transaction_logs ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE payments IS 'Payment transactions with Paystack integration';
COMMENT ON TABLE payment_authorizations IS 'Stores Paystack card authorizations for recurring payments';
COMMENT ON TABLE payment_transaction_logs IS 'Detailed log of all payment transactions and attempts';

COMMENT ON COLUMN payment_authorizations.authorization_code IS 'Paystack authorization code for charging card';
COMMENT ON COLUMN payment_authorizations.customer_code IS 'Paystack customer code';
COMMENT ON COLUMN payment_authorizations.verification_amount IS 'Amount charged for card verification (default R1)';
COMMENT ON COLUMN payment_authorizations.deleted_at IS 'Soft delete timestamp';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Payment system tables created with Paystack integration';
END $$;

