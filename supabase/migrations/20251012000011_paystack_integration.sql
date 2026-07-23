-- =====================================================
-- Paystack Payment Integration
-- Migration from Ozow to Paystack
-- =====================================================

-- =====================================================
-- UPDATE PAYMENTS TABLE - Replace Ozow with Paystack
-- =====================================================

-- Remove Ozow-specific columns
ALTER TABLE payments
    DROP COLUMN IF EXISTS ozow_transaction_id,
    DROP COLUMN IF EXISTS ozow_site_code,
    DROP COLUMN IF EXISTS ozow_payment_status,
    DROP COLUMN IF EXISTS ozow_reference,
    DROP COLUMN IF EXISTS ozow_response;

-- Add Paystack-specific columns
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS paystack_reference TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS paystack_authorization_code TEXT,
    ADD COLUMN IF NOT EXISTS paystack_transaction_id BIGINT,
    ADD COLUMN IF NOT EXISTS paystack_access_code TEXT,
    ADD COLUMN IF NOT EXISTS paystack_customer_code TEXT,
    ADD COLUMN IF NOT EXISTS paystack_response JSONB,
    ADD COLUMN IF NOT EXISTS gateway_response TEXT,
    ADD COLUMN IF NOT EXISTS channel TEXT,
    ADD COLUMN IF NOT EXISTS card_type TEXT,
    ADD COLUMN IF NOT EXISTS bank TEXT,
    ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT 'ZA',
    ADD COLUMN IF NOT EXISTS ip_address TEXT;

-- Update payment_method enum to use Paystack
ALTER TABLE payments 
    DROP CONSTRAINT IF EXISTS payments_payment_method_check;

ALTER TABLE payments
    ADD CONSTRAINT payments_payment_method_check 
    CHECK (payment_method IN ('paystack', 'card', 'bank_transfer', 'cash', 'other'));

-- Update default payment method
ALTER TABLE payments
    ALTER COLUMN payment_method SET DEFAULT 'paystack';

-- Create indexes for Paystack fields
CREATE INDEX IF NOT EXISTS idx_payments_paystack_reference ON payments(paystack_reference);
CREATE INDEX IF NOT EXISTS idx_payments_paystack_customer_code ON payments(paystack_customer_code);
CREATE INDEX IF NOT EXISTS idx_payments_paystack_transaction_id ON payments(paystack_transaction_id);

-- =====================================================
-- PAYMENT AUTHORIZATIONS TABLE
-- Store card authorizations for recurring payments
-- =====================================================

CREATE TABLE IF NOT EXISTS payment_authorizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Paystack authorization details
    authorization_code TEXT NOT NULL UNIQUE,
    customer_code TEXT NOT NULL,
    
    -- Card details (as provided by Paystack)
    card_type TEXT, -- visa, mastercard, etc
    last4 TEXT NOT NULL,
    exp_month TEXT NOT NULL,
    exp_year TEXT NOT NULL,
    bin TEXT, -- First 6 digits
    bank TEXT,
    brand TEXT,
    country_code TEXT DEFAULT 'ZA',
    
    -- Authorization metadata
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    reusable BOOLEAN DEFAULT true,
    
    -- Verification
    verified_at TIMESTAMPTZ DEFAULT NOW(),
    verification_amount DECIMAL(10, 2) DEFAULT 1.00, -- R1 verification charge
    
    -- Additional info
    email TEXT,
    signature TEXT, -- Paystack signature
    channel TEXT, -- card, bank, ussd, etc
    
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

-- Create indexes
CREATE INDEX idx_payment_auth_org ON payment_authorizations(organization_id);
CREATE INDEX idx_payment_auth_user ON payment_authorizations(user_id);
CREATE INDEX idx_payment_auth_code ON payment_authorizations(authorization_code);
CREATE INDEX idx_payment_auth_customer ON payment_authorizations(customer_code);
CREATE INDEX idx_payment_auth_active ON payment_authorizations(is_active, deleted_at);
CREATE INDEX idx_payment_auth_default ON payment_authorizations(user_id, is_default) WHERE is_default = true;
CREATE INDEX idx_payment_auth_created ON payment_authorizations(created_at DESC);

-- =====================================================
-- PAYMENT TRANSACTIONS LOG TABLE
-- Detailed log of all payment attempts
-- =====================================================

CREATE TABLE IF NOT EXISTS payment_transaction_logs (
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

CREATE INDEX idx_payment_logs_payment ON payment_transaction_logs(payment_id);
CREATE INDEX idx_payment_logs_auth ON payment_transaction_logs(authorization_id);
CREATE INDEX idx_payment_logs_reference ON payment_transaction_logs(reference);
CREATE INDEX idx_payment_logs_created ON payment_transaction_logs(created_at DESC);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to soft delete authorization
CREATE OR REPLACE FUNCTION delete_payment_authorization(
    p_authorization_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    v_affected INTEGER;
BEGIN
    UPDATE payment_authorizations
    SET 
        is_active = false,
        deleted_at = NOW(),
        updated_at = NOW()
    WHERE id = p_authorization_id
        AND user_id = p_user_id
        AND deleted_at IS NULL;
    
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    
    RETURN v_affected > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to set default authorization
CREATE OR REPLACE FUNCTION set_default_authorization(
    p_authorization_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Remove default from all other authorizations
    UPDATE payment_authorizations
    SET is_default = false, updated_at = NOW()
    WHERE user_id = p_user_id
        AND id != p_authorization_id;
    
    -- Set the selected one as default
    UPDATE payment_authorizations
    SET is_default = true, updated_at = NOW()
    WHERE id = p_authorization_id
        AND user_id = p_user_id
        AND is_active = true
        AND deleted_at IS NULL;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active authorizations for user
CREATE OR REPLACE FUNCTION get_user_authorizations(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    authorization_code TEXT,
    card_type TEXT,
    last4 TEXT,
    exp_month TEXT,
    exp_year TEXT,
    bank TEXT,
    is_default BOOLEAN,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pa.id,
        pa.authorization_code,
        pa.card_type,
        pa.last4,
        pa.exp_month,
        pa.exp_year,
        pa.bank,
        pa.is_default,
        pa.last_used_at,
        pa.created_at
    FROM payment_authorizations pa
    WHERE pa.user_id = p_user_id
        AND pa.is_active = true
        AND pa.deleted_at IS NULL
    ORDER BY pa.is_default DESC, pa.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update authorization usage
CREATE OR REPLACE FUNCTION update_authorization_usage(
    p_authorization_id UUID,
    p_success BOOLEAN
)
RETURNS VOID AS $$
BEGIN
    IF p_success THEN
        UPDATE payment_authorizations
        SET 
            last_used_at = NOW(),
            usage_count = usage_count + 1,
            updated_at = NOW()
        WHERE id = p_authorization_id;
    ELSE
        UPDATE payment_authorizations
        SET 
            failed_attempts = failed_attempts + 1,
            updated_at = NOW()
        WHERE id = p_authorization_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Update timestamp trigger
CREATE TRIGGER update_payment_auth_updated_at 
    BEFORE UPDATE ON payment_authorizations
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE payment_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transaction_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own authorizations
CREATE POLICY "Users can view own authorizations"
    ON payment_authorizations FOR SELECT
    USING (auth.uid() = user_id);

-- Users can delete their own authorizations
CREATE POLICY "Users can delete own authorizations"
    ON payment_authorizations FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can view their own transaction logs
CREATE POLICY "Users can view own transaction logs"
    ON payment_transaction_logs FOR SELECT
    USING (
        authorization_id IN (
            SELECT id FROM payment_authorizations 
            WHERE user_id = auth.uid()
        )
    );

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE payment_authorizations IS 'Stores Paystack card authorizations for recurring payments';
COMMENT ON TABLE payment_transaction_logs IS 'Detailed log of all payment transactions and attempts';

COMMENT ON COLUMN payment_authorizations.authorization_code IS 'Paystack authorization code for charging card';
COMMENT ON COLUMN payment_authorizations.customer_code IS 'Paystack customer code';
COMMENT ON COLUMN payment_authorizations.verification_amount IS 'Amount charged for card verification (default R1)';
COMMENT ON COLUMN payment_authorizations.deleted_at IS 'Soft delete timestamp';

COMMENT ON FUNCTION delete_payment_authorization IS 'Soft delete a payment authorization';
COMMENT ON FUNCTION set_default_authorization IS 'Set an authorization as the default payment method';
COMMENT ON FUNCTION get_user_authorizations IS 'Get all active authorizations for a user';
COMMENT ON FUNCTION update_authorization_usage IS 'Update usage statistics for an authorization';

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

GRANT SELECT ON payment_authorizations TO authenticated;
GRANT UPDATE ON payment_authorizations TO authenticated;
GRANT SELECT ON payment_transaction_logs TO authenticated;

GRANT EXECUTE ON FUNCTION delete_payment_authorization TO authenticated;
GRANT EXECUTE ON FUNCTION set_default_authorization TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_authorizations TO authenticated;

