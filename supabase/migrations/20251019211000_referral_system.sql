-- =====================================================
-- REFERRAL SYSTEM
-- =====================================================
-- Referrer gets 1 month free, referred customer gets 1 month free
-- Deposits are always required per bot (non-refundable)
-- =====================================================

-- =====================================================
-- REFERRAL CODES TABLE
-- =====================================================
-- Each user/organization gets a unique referral code

CREATE TABLE referral_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Who owns this code
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- The referral code (unique, human-readable)
    code TEXT UNIQUE NOT NULL,
    
    -- Usage tracking
    times_used INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT NULL,  -- NULL = unlimited
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    
    CONSTRAINT valid_code_format CHECK (code ~ '^[A-Z0-9]{6,12}$')
);

-- =====================================================
-- REFERRALS TABLE
-- =====================================================
-- Track who referred whom and reward status

CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Referral code used
    referral_code_id UUID NOT NULL REFERENCES referral_codes(id) ON DELETE RESTRICT,
    code_used TEXT NOT NULL,  -- Store code for history
    
    -- Who was referred (the referrer)
    referrer_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    referrer_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    
    -- Who signed up (the referee)
    referee_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    referee_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Status tracking
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending',           -- Signup complete, waiting for first payment
        'qualified',         -- First payment made, ready to reward
        'rewarded',          -- Both parties have received rewards
        'expired',           -- Referral expired before qualifying
        'cancelled'          -- Signup cancelled before qualifying
    )),
    
    -- Qualification requirements
    qualified_at TIMESTAMPTZ,
    first_payment_date TIMESTAMPTZ,
    deposit_paid BOOLEAN DEFAULT false,
    deposit_amount DECIMAL(10, 2),
    
    -- Rewards tracking
    referrer_reward_applied BOOLEAN DEFAULT false,
    referrer_reward_applied_at TIMESTAMPTZ,
    referrer_reward_invoice_id UUID,  -- References invoices table
    referrer_free_months_granted INTEGER DEFAULT 0,
    
    referee_reward_applied BOOLEAN DEFAULT false,
    referee_reward_applied_at TIMESTAMPTZ,
    referee_reward_invoice_id UUID,  -- References invoices table
    referee_free_months_granted INTEGER DEFAULT 0,
    
    -- Bot context (which bot/service triggered the referral)
    bot_type TEXT CHECK (bot_type IN ('mow_bot', 'pool_bot', 'security_bot', 'weather_station')),
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    
    -- Metadata
    referral_source TEXT,  -- 'web', 'mobile', 'in_person', etc.
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(referee_organization_id),  -- Each org can only be referred once
    CONSTRAINT no_self_referral CHECK (referrer_organization_id != referee_organization_id)
);

-- =====================================================
-- DEPOSITS TABLE
-- =====================================================
-- Track deposits paid per bot (always required, non-refundable)

CREATE TABLE deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Who paid the deposit
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    paid_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    
    -- What the deposit is for
    bot_id UUID REFERENCES bots(id) ON DELETE RESTRICT,
    bot_type TEXT NOT NULL CHECK (bot_type IN ('mow_bot', 'pool_bot', 'security_bot', 'weather_station')),
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    
    -- Deposit details
    deposit_amount DECIMAL(10, 2) NOT NULL,
    deposit_type TEXT DEFAULT 'bot_rental' CHECK (deposit_type IN (
        'bot_rental',        -- Standard bot deposit
        'equipment',         -- Additional equipment deposit
        'damage_insurance'   -- Optional damage insurance deposit
    )),
    
    -- Payment tracking
    payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN (
        'pending',
        'paid',
        'refunded',          -- Only if service cancelled within grace period
        'forfeited'          -- Applied to damages or final bill
    )),
    paid_at TIMESTAMPTZ,
    payment_method TEXT,
    payment_reference TEXT,
    
    -- Refund tracking (only in special cases)
    is_refundable BOOLEAN DEFAULT false,
    refund_eligibility_date DATE,  -- Date after which it's non-refundable
    refunded_at TIMESTAMPTZ,
    refunded_to UUID REFERENCES profiles(id),
    refund_amount DECIMAL(10, 2),
    refund_reason TEXT,
    
    -- Forfeiture tracking
    forfeited_at TIMESTAMPTZ,
    forfeited_reason TEXT,
    applied_to_invoice_id UUID,  -- If applied to final invoice
    
    -- Metadata
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- REFERRAL REWARDS TABLE
-- =====================================================
-- Track individual reward credits applied to accounts

CREATE TABLE referral_rewards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Which referral triggered this reward
    referral_id UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
    
    -- Who receives the reward
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Reward type
    reward_type TEXT NOT NULL CHECK (reward_type IN (
        'referrer_bonus',    -- Reward for referring someone
        'referee_bonus'      -- Reward for being referred
    )),
    
    -- Reward details
    free_months INTEGER DEFAULT 1,
    discount_percentage DECIMAL(5, 2),  -- Optional: percentage discount instead
    credit_amount DECIMAL(10, 2),       -- Optional: credit amount instead
    
    -- Application status
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending',           -- Approved but not yet applied
        'applied',           -- Applied to an invoice
        'expired',           -- Not used within validity period
        'cancelled'          -- Cancelled for some reason
    )),
    
    -- Validity
    valid_from DATE DEFAULT CURRENT_DATE,
    valid_until DATE,
    applied_at TIMESTAMPTZ,
    applied_to_invoice_id UUID,  -- References invoices table
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Referral codes
CREATE INDEX idx_referral_codes_org_id ON referral_codes(organization_id);
CREATE INDEX idx_referral_codes_code ON referral_codes(code);
CREATE INDEX idx_referral_codes_is_active ON referral_codes(is_active);
CREATE INDEX idx_referral_codes_created_by ON referral_codes(created_by);

-- Referrals
CREATE INDEX idx_referrals_code_id ON referrals(referral_code_id);
CREATE INDEX idx_referrals_referrer_org ON referrals(referrer_organization_id);
CREATE INDEX idx_referrals_referee_org ON referrals(referee_organization_id);
CREATE INDEX idx_referrals_status ON referrals(status);
CREATE INDEX idx_referrals_created_at ON referrals(created_at DESC);
CREATE INDEX idx_referrals_qualified_at ON referrals(qualified_at DESC);

-- Deposits
CREATE INDEX idx_deposits_org_id ON deposits(organization_id);
CREATE INDEX idx_deposits_bot_id ON deposits(bot_id);
CREATE INDEX idx_deposits_service_id ON deposits(service_id);
CREATE INDEX idx_deposits_payment_status ON deposits(payment_status);
CREATE INDEX idx_deposits_paid_at ON deposits(paid_at DESC);

-- Referral rewards
CREATE INDEX idx_referral_rewards_referral_id ON referral_rewards(referral_id);
CREATE INDEX idx_referral_rewards_org_id ON referral_rewards(organization_id);
CREATE INDEX idx_referral_rewards_status ON referral_rewards(status);
CREATE INDEX idx_referral_rewards_valid_until ON referral_rewards(valid_until);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function: Generate unique referral code
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TEXT AS $$
DECLARE
    new_code TEXT;
    code_exists BOOLEAN;
BEGIN
    LOOP
        -- Generate 8-character code: First 4 from org name, last 4 random
        new_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
        
        -- Check if code exists
        SELECT EXISTS(SELECT 1 FROM referral_codes WHERE code = new_code) INTO code_exists;
        
        EXIT WHEN NOT code_exists;
    END LOOP;
    
    RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- Function: Create referral code for organization
CREATE OR REPLACE FUNCTION create_referral_code(
    p_organization_id UUID,
    p_created_by UUID,
    p_custom_code TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_code TEXT;
    v_referral_code_id UUID;
BEGIN
    -- Use custom code or generate one
    IF p_custom_code IS NOT NULL THEN
        v_code := UPPER(p_custom_code);
        
        -- Validate format
        IF NOT (v_code ~ '^[A-Z0-9]{6,12}$') THEN
            RAISE EXCEPTION 'Invalid code format. Use 6-12 alphanumeric characters.';
        END IF;
        
        -- Check if code already exists
        IF EXISTS(SELECT 1 FROM referral_codes WHERE code = v_code) THEN
            RAISE EXCEPTION 'Code already exists. Please choose a different code.';
        END IF;
    ELSE
        v_code := generate_referral_code();
    END IF;
    
    -- Insert the referral code
    INSERT INTO referral_codes (organization_id, created_by, code)
    VALUES (p_organization_id, p_created_by, v_code)
    RETURNING id INTO v_referral_code_id;
    
    RETURN v_referral_code_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Apply referral code during signup
CREATE OR REPLACE FUNCTION apply_referral_code(
    p_code TEXT,
    p_referee_organization_id UUID,
    p_referee_profile_id UUID,
    p_bot_type TEXT DEFAULT NULL,
    p_service_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_code_record RECORD;
    v_referral_id UUID;
BEGIN
    -- Find and validate the referral code
    SELECT * INTO v_code_record
    FROM referral_codes
    WHERE code = UPPER(p_code)
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (max_uses IS NULL OR times_used < max_uses);
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired referral code';
    END IF;
    
    -- Check if referee organization already used a referral
    IF EXISTS(SELECT 1 FROM referrals WHERE referee_organization_id = p_referee_organization_id) THEN
        RAISE EXCEPTION 'Organization has already used a referral code';
    END IF;
    
    -- Check for self-referral
    IF v_code_record.organization_id = p_referee_organization_id THEN
        RAISE EXCEPTION 'Cannot use your own referral code';
    END IF;
    
    -- Create the referral record
    INSERT INTO referrals (
        referral_code_id,
        code_used,
        referrer_organization_id,
        referrer_profile_id,
        referee_organization_id,
        referee_profile_id,
        bot_type,
        service_id,
        status
    ) VALUES (
        v_code_record.id,
        v_code_record.code,
        v_code_record.organization_id,
        v_code_record.created_by,
        p_referee_organization_id,
        p_referee_profile_id,
        p_bot_type,
        p_service_id,
        'pending'
    )
    RETURNING id INTO v_referral_id;
    
    -- Update referral code usage
    UPDATE referral_codes
    SET 
        times_used = times_used + 1,
        last_used_at = NOW()
    WHERE id = v_code_record.id;
    
    RETURN v_referral_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Qualify referral after deposit payment
CREATE OR REPLACE FUNCTION qualify_referral(
    p_referral_id UUID,
    p_deposit_amount DECIMAL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_referral RECORD;
    v_reward_valid_until DATE;
BEGIN
    -- Get referral details
    SELECT * INTO v_referral
    FROM referrals
    WHERE id = p_referral_id
        AND status = 'pending';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referral not found or already qualified';
    END IF;
    
    -- Set reward validity (12 months from now)
    v_reward_valid_until := CURRENT_DATE + INTERVAL '12 months';
    
    -- Update referral to qualified status
    UPDATE referrals
    SET 
        status = 'qualified',
        qualified_at = NOW(),
        first_payment_date = NOW(),
        deposit_paid = true,
        deposit_amount = p_deposit_amount,
        updated_at = NOW()
    WHERE id = p_referral_id;
    
    -- Create reward for REFERRER (person who referred)
    INSERT INTO referral_rewards (
        referral_id,
        organization_id,
        profile_id,
        reward_type,
        free_months,
        status,
        valid_until
    ) VALUES (
        p_referral_id,
        v_referral.referrer_organization_id,
        v_referral.referrer_profile_id,
        'referrer_bonus',
        1,  -- 1 month free
        'pending',
        v_reward_valid_until
    );
    
    -- Create reward for REFEREE (person who was referred)
    INSERT INTO referral_rewards (
        referral_id,
        organization_id,
        profile_id,
        reward_type,
        free_months,
        status,
        valid_until
    ) VALUES (
        p_referral_id,
        v_referral.referee_organization_id,
        v_referral.referee_profile_id,
        'referee_bonus',
        1,  -- 1 month free
        'pending',
        v_reward_valid_until
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Record deposit payment
CREATE OR REPLACE FUNCTION record_deposit_payment(
    p_organization_id UUID,
    p_paid_by UUID,
    p_bot_type TEXT,
    p_deposit_amount DECIMAL,
    p_payment_method TEXT DEFAULT 'card',
    p_payment_reference TEXT DEFAULT NULL,
    p_bot_id UUID DEFAULT NULL,
    p_service_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_deposit_id UUID;
    v_referral_id UUID;
BEGIN
    -- Create deposit record
    INSERT INTO deposits (
        organization_id,
        paid_by,
        bot_id,
        bot_type,
        service_id,
        deposit_amount,
        payment_status,
        paid_at,
        payment_method,
        payment_reference
    ) VALUES (
        p_organization_id,
        p_paid_by,
        p_bot_id,
        p_bot_type,
        p_service_id,
        p_deposit_amount,
        'paid',
        NOW(),
        p_payment_method,
        p_payment_reference
    )
    RETURNING id INTO v_deposit_id;
    
    -- Check if this qualifies a referral
    SELECT id INTO v_referral_id
    FROM referrals
    WHERE referee_organization_id = p_organization_id
        AND status = 'pending'
        AND deposit_paid = false
    LIMIT 1;
    
    -- If there's a pending referral, qualify it
    IF v_referral_id IS NOT NULL THEN
        PERFORM qualify_referral(v_referral_id, p_deposit_amount);
    END IF;
    
    RETURN v_deposit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get available referral rewards for an organization
CREATE OR REPLACE FUNCTION get_available_referral_rewards(
    p_organization_id UUID
)
RETURNS TABLE (
    reward_id UUID,
    referral_id UUID,
    reward_type TEXT,
    free_months INTEGER,
    valid_until DATE,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        rr.id as reward_id,
        rr.referral_id,
        rr.reward_type,
        rr.free_months,
        rr.valid_until,
        rr.created_at
    FROM referral_rewards rr
    WHERE rr.organization_id = p_organization_id
        AND rr.status = 'pending'
        AND (rr.valid_until IS NULL OR rr.valid_until >= CURRENT_DATE)
    ORDER BY rr.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_referral_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_referrals_updated_at
    BEFORE UPDATE ON referrals
    FOR EACH ROW
    EXECUTE FUNCTION update_referral_updated_at();

CREATE TRIGGER trigger_update_deposits_updated_at
    BEFORE UPDATE ON deposits
    FOR EACH ROW
    EXECUTE FUNCTION update_referral_updated_at();

CREATE TRIGGER trigger_update_referral_rewards_updated_at
    BEFORE UPDATE ON referral_rewards
    FOR EACH ROW
    EXECUTE FUNCTION update_referral_updated_at();

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

GRANT EXECUTE ON FUNCTION generate_referral_code() TO authenticated;
GRANT EXECUTE ON FUNCTION create_referral_code(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_referral_code(TEXT, UUID, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION qualify_referral(UUID, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION record_deposit_payment(UUID, UUID, TEXT, DECIMAL, TEXT, TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_available_referral_rewards(UUID) TO authenticated;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE referral_codes IS 'Unique referral codes for each organization to share with potential customers';
COMMENT ON TABLE referrals IS 'Tracks referral relationships between referrer and referee, including reward status';
COMMENT ON TABLE deposits IS 'Tracks deposits paid per bot - always required and typically non-refundable';
COMMENT ON TABLE referral_rewards IS 'Individual reward credits (free months) that can be applied to invoices';

COMMENT ON COLUMN referrals.status IS 'pending=signed up, qualified=deposit paid, rewarded=rewards applied';
COMMENT ON COLUMN deposits.deposit_type IS 'Type of deposit: bot rental, equipment, or damage insurance';
COMMENT ON COLUMN deposits.is_refundable IS 'Most deposits are non-refundable, but exceptions can be made';
COMMENT ON COLUMN referral_rewards.reward_type IS 'referrer_bonus=reward for referring, referee_bonus=reward for being referred';

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '=== REFERRAL SYSTEM CREATED ===';
    RAISE NOTICE 'Tables: referral_codes, referrals, deposits, referral_rewards';
    RAISE NOTICE 'Referral Flow:';
    RAISE NOTICE '  1. Organization gets referral code via create_referral_code()';
    RAISE NOTICE '  2. New customer uses code via apply_referral_code()';
    RAISE NOTICE '  3. New customer pays deposit via record_deposit_payment()';
    RAISE NOTICE '  4. Both parties automatically get 1 month free reward';
    RAISE NOTICE '  5. Rewards can be applied to future invoices';
    RAISE NOTICE '';
    RAISE NOTICE 'Key Rule: Deposits are ALWAYS required per bot';
    RAISE NOTICE 'Reward: Both referrer and referee get 1 month free';
END $$;

