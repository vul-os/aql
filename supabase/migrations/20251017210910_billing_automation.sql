-- =====================================================
-- Automated Billing System Tables
-- =====================================================

-- PAYMENT_ATTEMPTS TABLE
CREATE TABLE payment_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- References
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    rental_agreement_id UUID REFERENCES rental_agreements(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Payment details
    authorization_code TEXT, -- Paystack authorization code
    amount DECIMAL(10, 2) NOT NULL,
    
    -- Attempt info
    attempt_number INTEGER NOT NULL DEFAULT 1,
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Result
    status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'retry')),
    paystack_reference TEXT,
    paystack_response JSONB,
    error_message TEXT,
    
    -- Next retry
    next_retry_at TIMESTAMPTZ,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BILLING_NOTIFICATIONS TABLE
CREATE TABLE billing_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- References
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    payment_attempt_id UUID REFERENCES payment_attempts(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Notification details
    notification_type TEXT NOT NULL CHECK (notification_type IN (
        'invoice_generated',
        'payment_success',
        'payment_failed',
        'payment_retry',
        'subscription_paused',
        'payment_overdue'
    )),
    
    -- Recipients (JSON array of email addresses)
    recipients JSONB NOT NULL DEFAULT '[]',
    
    -- Email details
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    html_body TEXT,
    
    -- Sending status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    sent_at TIMESTAMPTZ,
    error_message TEXT,
    
    -- Resend details
    resend_email_id TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for payment_attempts
CREATE INDEX IF NOT EXISTS idx_payment_attempts_invoice ON payment_attempts(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_user ON payment_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON payment_attempts(status);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_next_retry ON payment_attempts(next_retry_at) WHERE next_retry_at IS NOT NULL;

-- Indexes for billing_notifications
CREATE INDEX IF NOT EXISTS idx_billing_notifications_invoice ON billing_notifications(invoice_id);
CREATE INDEX IF NOT EXISTS idx_billing_notifications_user ON billing_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_notifications_status ON billing_notifications(status);
CREATE INDEX IF NOT EXISTS idx_billing_notifications_type ON billing_notifications(notification_type);

-- Enable RLS
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_notifications ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE payment_attempts IS 'Track all payment collection attempts with retry logic';
COMMENT ON TABLE billing_notifications IS 'Queue for billing-related email notifications via Resend';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Billing automation tables created: payment_attempts, billing_notifications';
END $$;

