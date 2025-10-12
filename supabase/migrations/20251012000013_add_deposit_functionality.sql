-- =====================================================
-- Add Deposit Functionality
-- R500 deposit per bot
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

-- Create deposits table for detailed tracking
CREATE TABLE IF NOT EXISTS deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Deposit amount
    amount_required DECIMAL(10, 2) NOT NULL DEFAULT 500.00,
    amount_paid DECIMAL(10, 2) DEFAULT 0.00,
    amount_refunded DECIMAL(10, 2) DEFAULT 0.00,
    amount_forfeited DECIMAL(10, 2) DEFAULT 0.00,
    
    currency TEXT DEFAULT 'ZAR',
    
    -- Status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'paid', 'partially_paid', 'refunded', 
        'partially_refunded', 'forfeited', 'cancelled'
    )),
    
    -- Payment tracking
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    refund_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    
    -- Dates
    due_date DATE,
    paid_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    forfeited_at TIMESTAMPTZ,
    
    -- Reason for forfeit/refund
    forfeit_reason TEXT,
    refund_reason TEXT,
    
    -- Metadata
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One deposit per bot
    UNIQUE(bot_id)
);

-- Create indexes
CREATE INDEX idx_deposits_bot_id ON deposits(bot_id);
CREATE INDEX idx_deposits_organization_id ON deposits(organization_id);
CREATE INDEX idx_deposits_status ON deposits(status);
CREATE INDEX idx_deposits_payment_id ON deposits(payment_id);
CREATE INDEX idx_deposits_due_date ON deposits(due_date);

-- Function to create deposit when bot is assigned
CREATE OR REPLACE FUNCTION create_bot_deposit(
    p_bot_id UUID,
    p_organization_id UUID,
    p_amount DECIMAL DEFAULT 500.00
)
RETURNS UUID AS $$
DECLARE
    v_deposit_id UUID;
BEGIN
    INSERT INTO deposits (
        bot_id,
        organization_id,
        amount_required,
        due_date,
        status
    ) VALUES (
        p_bot_id,
        p_organization_id,
        p_amount,
        CURRENT_DATE + INTERVAL '7 days', -- Due in 7 days
        'pending'
    )
    RETURNING id INTO v_deposit_id;
    
    -- Update bot deposit status
    UPDATE bots
    SET 
        deposit_required = p_amount,
        deposit_status = 'pending'
    WHERE id = p_bot_id;
    
    RETURN v_deposit_id;
END;
$$ LANGUAGE plpgsql;

-- Function to record deposit payment
CREATE OR REPLACE FUNCTION record_deposit_payment(
    p_deposit_id UUID,
    p_payment_id UUID,
    p_amount DECIMAL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_bot_id UUID;
    v_total_paid DECIMAL;
    v_required DECIMAL;
    v_new_status TEXT;
BEGIN
    -- Get deposit details
    SELECT bot_id, amount_required, amount_paid + p_amount
    INTO v_bot_id, v_required, v_total_paid
    FROM deposits
    WHERE id = p_deposit_id;
    
    -- Determine new status
    IF v_total_paid >= v_required THEN
        v_new_status := 'paid';
    ELSE
        v_new_status := 'partially_paid';
    END IF;
    
    -- Update deposit
    UPDATE deposits
    SET 
        amount_paid = v_total_paid,
        payment_id = p_payment_id,
        status = v_new_status,
        paid_at = CASE WHEN v_new_status = 'paid' THEN NOW() ELSE paid_at END,
        updated_at = NOW()
    WHERE id = p_deposit_id;
    
    -- Update bot
    UPDATE bots
    SET 
        deposit_paid = v_total_paid,
        deposit_paid_at = CASE WHEN v_new_status = 'paid' THEN NOW() ELSE deposit_paid_at END,
        deposit_status = v_new_status
    WHERE id = v_bot_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to refund deposit
CREATE OR REPLACE FUNCTION refund_deposit(
    p_deposit_id UUID,
    p_refund_amount DECIMAL,
    p_refund_payment_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_bot_id UUID;
    v_total_refunded DECIMAL;
    v_paid DECIMAL;
BEGIN
    -- Get deposit details
    SELECT bot_id, amount_paid, amount_refunded + p_refund_amount
    INTO v_bot_id, v_paid, v_total_refunded
    FROM deposits
    WHERE id = p_deposit_id;
    
    -- Update deposit
    UPDATE deposits
    SET 
        amount_refunded = v_total_refunded,
        refund_payment_id = p_refund_payment_id,
        refund_reason = p_reason,
        status = CASE 
            WHEN v_total_refunded >= v_paid THEN 'refunded'
            ELSE 'partially_refunded'
        END,
        refunded_at = CASE WHEN v_total_refunded >= v_paid THEN NOW() ELSE refunded_at END,
        updated_at = NOW()
    WHERE id = p_deposit_id;
    
    -- Update bot
    UPDATE bots
    SET 
        deposit_refunded = v_total_refunded,
        deposit_status = CASE 
            WHEN v_total_refunded >= v_paid THEN 'refunded'
            ELSE 'partially_refunded'
        END
    WHERE id = v_bot_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update deposit timestamp
CREATE TRIGGER update_deposits_updated_at 
    BEFORE UPDATE ON deposits
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE deposits IS 'Tracks R500 deposit per bot for damage/early cancellation';
COMMENT ON COLUMN deposits.amount_required IS 'Deposit amount required (default R500)';
COMMENT ON COLUMN deposits.amount_paid IS 'Amount of deposit actually paid';
COMMENT ON COLUMN deposits.amount_refunded IS 'Amount refunded to customer';
COMMENT ON COLUMN deposits.amount_forfeited IS 'Amount forfeited (not refunded)';

COMMENT ON FUNCTION create_bot_deposit IS 'Create a deposit record when bot is assigned';
COMMENT ON FUNCTION record_deposit_payment IS 'Record a deposit payment';
COMMENT ON FUNCTION refund_deposit IS 'Process deposit refund';

-- Grant permissions
GRANT SELECT ON deposits TO authenticated;
GRANT EXECUTE ON FUNCTION create_bot_deposit TO authenticated;
GRANT EXECUTE ON FUNCTION record_deposit_payment TO authenticated;
GRANT EXECUTE ON FUNCTION refund_deposit TO authenticated;

