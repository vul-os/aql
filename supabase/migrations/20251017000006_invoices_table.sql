-- =====================================================
-- Invoices Table
-- Monthly billing for bot rental and service visits
-- =====================================================

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Invoice identification
    invoice_number TEXT UNIQUE NOT NULL, -- e.g., "INV-2025-001234"
    
    -- References
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rental_agreement_id UUID REFERENCES rental_agreements(id) ON DELETE SET NULL,
    
    -- Invoice period
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Billing details
    bot_rental_total DECIMAL(10, 2) NOT NULL DEFAULT 0,
    service_visits_total DECIMAL(10, 2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0,
    
    -- Taxes and fees
    tax_rate DECIMAL(5, 2) DEFAULT 15.00, -- VAT (15% in SA)
    tax_amount DECIMAL(10, 2) DEFAULT 0,
    
    -- Total
    total_amount DECIMAL(10, 2) NOT NULL,
    amount_paid DECIMAL(10, 2) DEFAULT 0,
    amount_due DECIMAL(10, 2) NOT NULL,
    
    -- Breakdown (JSON for flexibility)
    line_items JSONB DEFAULT '[]', -- Array of {description, quantity, unit_price, total}
    
    -- Status
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled', 'refunded')),
    
    -- Dates
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    paid_date DATE,
    
    -- Payment information
    payment_method TEXT, -- 'paystack', 'card', 'eft', etc.
    payment_reference TEXT,
    paystack_reference TEXT,
    
    -- Document
    invoice_pdf_url TEXT, -- CDN URL to generated PDF
    
    -- Billing address (snapshot at time of invoice)
    billing_name TEXT,
    billing_address TEXT,
    billing_city TEXT,
    billing_province TEXT,
    billing_postal_code TEXT,
    billing_email TEXT,
    
    -- Notes
    notes TEXT,
    internal_notes TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_period CHECK (period_end >= period_start),
    CONSTRAINT valid_amounts CHECK (total_amount >= 0 AND amount_paid >= 0 AND amount_due >= 0)
);

-- Indexes
CREATE INDEX idx_invoices_user ON invoices(user_id);
CREATE INDEX idx_invoices_org ON invoices(organization_id);
CREATE INDEX idx_invoices_agreement ON invoices(rental_agreement_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_invoices_period ON invoices(period_start, period_end);

-- Function to generate invoice number
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT AS $$
DECLARE
    v_year TEXT;
    v_month TEXT;
    v_count INTEGER;
    v_number TEXT;
BEGIN
    v_year := TO_CHAR(NOW(), 'YYYY');
    v_month := TO_CHAR(NOW(), 'MM');
    
    -- Get count of invoices this month
    SELECT COUNT(*) + 1 INTO v_count
    FROM invoices
    WHERE invoice_number LIKE 'INV-' || v_year || v_month || '-%';
    
    -- Format: INV-YYYYMM-NNNN
    v_number := 'INV-' || v_year || v_month || '-' || LPAD(v_count::TEXT, 4, '0');
    
    RETURN v_number;
END;
$$ LANGUAGE plpgsql;

-- Function to create monthly invoice from rental agreement
CREATE OR REPLACE FUNCTION create_monthly_invoice(
    p_rental_agreement_id UUID,
    p_period_start DATE,
    p_period_end DATE,
    p_bot_rental_days INTEGER DEFAULT 30,
    p_service_visits INTEGER DEFAULT 0
)
RETURNS JSON AS $$
DECLARE
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_agreement RECORD;
    v_profile RECORD;
    v_bot_rental_total DECIMAL;
    v_service_total DECIMAL;
    v_subtotal DECIMAL;
    v_tax_amount DECIMAL;
    v_total DECIMAL;
    v_line_items JSONB;
BEGIN
    -- Get rental agreement
    SELECT * INTO v_agreement
    FROM rental_agreements
    WHERE id = p_rental_agreement_id;
    
    IF v_agreement IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Rental agreement not found');
    END IF;
    
    -- Get user profile for billing info
    SELECT * INTO v_profile
    FROM profiles
    WHERE id = v_agreement.user_id;
    
    -- Calculate prorated bot rental if not full month
    IF p_bot_rental_days < 30 THEN
        v_bot_rental_total := ROUND((v_agreement.bot_rental_total / 30.0) * p_bot_rental_days, 2);
    ELSE
        v_bot_rental_total := v_agreement.bot_rental_total;
    END IF;
    
    -- Calculate service visits cost
    IF p_service_visits > 0 THEN
        v_service_total := ROUND((v_agreement.service_total / v_agreement.services_per_month::DECIMAL) * p_service_visits, 2);
    ELSE
        v_service_total := 0;
    END IF;
    
    -- Calculate totals
    v_subtotal := v_bot_rental_total + v_service_total;
    v_tax_amount := ROUND(v_subtotal * 0.15, 2); -- 15% VAT
    v_total := v_subtotal + v_tax_amount;
    
    -- Build line items
    v_line_items := jsonb_build_array(
        jsonb_build_object(
            'description', 'Bot Rental (' || v_agreement.number_of_bots || ' bot' || CASE WHEN v_agreement.number_of_bots > 1 THEN 's' ELSE '' END || ' × ' || p_bot_rental_days || ' days)',
            'quantity', v_agreement.number_of_bots,
            'unit_price', ROUND(v_bot_rental_total / v_agreement.number_of_bots, 2),
            'total', v_bot_rental_total
        ),
        jsonb_build_object(
            'description', 'Service Visits (edge trimming + bot swap)',
            'quantity', p_service_visits,
            'unit_price', CASE WHEN p_service_visits > 0 THEN ROUND(v_service_total / p_service_visits, 2) ELSE 0 END,
            'total', v_service_total
        )
    );
    
    -- Generate invoice number
    v_invoice_number := generate_invoice_number();
    
    -- Create invoice
    INSERT INTO invoices (
        invoice_number,
        user_id,
        organization_id,
        rental_agreement_id,
        period_start,
        period_end,
        bot_rental_total,
        service_visits_total,
        subtotal,
        tax_rate,
        tax_amount,
        total_amount,
        amount_due,
        line_items,
        status,
        issue_date,
        due_date,
        billing_name,
        billing_address,
        billing_city,
        billing_province,
        billing_postal_code,
        billing_email
    ) VALUES (
        v_invoice_number,
        v_agreement.user_id,
        v_agreement.organization_id,
        p_rental_agreement_id,
        p_period_start,
        p_period_end,
        v_bot_rental_total,
        v_service_total,
        v_subtotal,
        15.00,
        v_tax_amount,
        v_total,
        v_total, -- Initially unpaid
        v_line_items,
        'sent',
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '14 days', -- Due in 14 days
        v_profile.first_name || ' ' || v_profile.surname,
        v_profile.physical_address,
        v_profile.physical_city,
        v_profile.physical_province,
        v_profile.physical_postal_code,
        v_profile.email
    )
    RETURNING id INTO v_invoice_id;
    
    RETURN json_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'total_amount', v_total,
        'due_date', CURRENT_DATE + INTERVAL '14 days'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark invoice as paid
CREATE OR REPLACE FUNCTION mark_invoice_paid(
    p_invoice_id UUID,
    p_amount DECIMAL,
    p_payment_method TEXT DEFAULT NULL,
    p_payment_reference TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_invoice RECORD;
    v_new_amount_paid DECIMAL;
    v_new_amount_due DECIMAL;
    v_new_status TEXT;
BEGIN
    -- Get current invoice
    SELECT * INTO v_invoice
    FROM invoices
    WHERE id = p_invoice_id;
    
    IF v_invoice IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Invoice not found');
    END IF;
    
    -- Calculate new amounts
    v_new_amount_paid := v_invoice.amount_paid + p_amount;
    v_new_amount_due := v_invoice.total_amount - v_new_amount_paid;
    
    -- Determine new status
    IF v_new_amount_due <= 0 THEN
        v_new_status := 'paid';
    ELSE
        v_new_status := 'sent'; -- Partially paid, keep as sent
    END IF;
    
    -- Update invoice
    UPDATE invoices
    SET 
        amount_paid = v_new_amount_paid,
        amount_due = v_new_amount_due,
        status = v_new_status,
        paid_date = CASE WHEN v_new_status = 'paid' THEN CURRENT_DATE ELSE paid_date END,
        payment_method = COALESCE(p_payment_method, payment_method),
        payment_reference = COALESCE(p_payment_reference, payment_reference),
        updated_at = NOW()
    WHERE id = p_invoice_id;
    
    RETURN json_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'amount_paid', v_new_amount_paid,
        'amount_due', v_new_amount_due,
        'status', v_new_status
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user invoices
CREATE OR REPLACE FUNCTION get_user_invoices(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    invoice_id UUID,
    invoice_number TEXT,
    period_start DATE,
    period_end DATE,
    total_amount DECIMAL,
    amount_paid DECIMAL,
    amount_due DECIMAL,
    status TEXT,
    issue_date DATE,
    due_date DATE,
    paid_date DATE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        i.id,
        i.invoice_number,
        i.period_start,
        i.period_end,
        i.total_amount,
        i.amount_paid,
        i.amount_due,
        i.status,
        i.issue_date,
        i.due_date,
        i.paid_date
    FROM invoices i
    WHERE i.user_id = p_user_id
    ORDER BY i.issue_date DESC, i.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update updated_at
CREATE TRIGGER update_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON invoices TO authenticated;
GRANT EXECUTE ON FUNCTION generate_invoice_number TO authenticated;
GRANT EXECUTE ON FUNCTION create_monthly_invoice TO authenticated;
GRANT EXECUTE ON FUNCTION mark_invoice_paid TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_invoices TO authenticated;

-- Add comments
COMMENT ON TABLE invoices IS 'Monthly invoices for bot rental and service visits';
COMMENT ON COLUMN invoices.invoice_number IS 'Unique invoice number (INV-YYYYMM-NNNN)';
COMMENT ON COLUMN invoices.line_items IS 'Array of line items: [{description, quantity, unit_price, total}]';
COMMENT ON COLUMN invoices.status IS 'draft: not sent, sent: awaiting payment, paid: fully paid, overdue: past due, cancelled: voided, refunded: money returned';

COMMENT ON FUNCTION create_monthly_invoice IS 'Create monthly invoice from rental agreement with prorated charges';
COMMENT ON FUNCTION mark_invoice_paid IS 'Record payment against invoice, supports partial payments';
COMMENT ON FUNCTION get_user_invoices IS 'Get all invoices for a user with pagination';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Invoices table created successfully';
    RAISE NOTICE 'Functions: create_monthly_invoice, mark_invoice_paid, get_user_invoices';
    RAISE NOTICE 'Invoice format: INV-YYYYMM-NNNN';
END $$;

