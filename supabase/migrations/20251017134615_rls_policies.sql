-- =====================================================
-- Row Level Security Policies
-- =====================================================

-- =====================================================
-- PAYMENT AUTHORIZATION POLICIES
-- =====================================================

-- Users can view their own authorizations
CREATE POLICY "Users can view own authorizations"
    ON payment_authorizations FOR SELECT
    USING (auth.uid() = user_id);

-- Users can delete their own authorizations
CREATE POLICY "Users can delete own authorizations"
    ON payment_authorizations FOR UPDATE
    USING (auth.uid() = user_id);

-- =====================================================
-- PAYMENT TRANSACTION LOGS POLICIES
-- =====================================================

-- Users can view their own transaction logs
CREATE POLICY "Users can view own transaction logs"
    ON payment_transaction_logs FOR SELECT
    USING (
        authorization_id IN (
            SELECT id FROM payment_authorizations 
            WHERE user_id = auth.uid()
        )
    );

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'RLS policies created for payment system';
    RAISE NOTICE 'Note: Additional RLS policies should be added based on your security requirements';
END $$;

