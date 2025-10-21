-- =====================================================
-- Invoices for Monthly Billing
-- =====================================================

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Invoice identification
    invoice_number TEXT UNIQUE NOT NULL, -- e.g., "INV-2025-001234"
    
    -- References
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rental_agreement_id UUID REFERENCES rental_agreements(id) ON DELETE CASCADE,
    
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
    
    -- Vendor/Company information (Exolution Technologies Pty Ltd)
    vendor_name TEXT DEFAULT 'BotKorp (Pty) Ltd',
    vendor_parent_company TEXT DEFAULT 'A member of Exolution Technologies (Pty) Ltd',
    vendor_trading_as TEXT DEFAULT 'Trading as BotKorp',
    vendor_registration_number TEXT DEFAULT '2024/567890/07',
    vendor_vat_number TEXT DEFAULT '4123456789',
    vendor_address_line1 TEXT DEFAULT 'MAP HOUSE',
    vendor_address_line2 TEXT DEFAULT 'Umbilo',
    vendor_city TEXT DEFAULT 'Durban',
    vendor_postal_code TEXT DEFAULT '4061',
    vendor_province TEXT DEFAULT 'KwaZulu-Natal',
    vendor_country TEXT DEFAULT 'South Africa',
    vendor_phone TEXT DEFAULT '+27 31 123 4567',
    vendor_email TEXT DEFAULT 'billing@botkorp.co.za',
    vendor_website TEXT DEFAULT 'www.botkorp.co.za',
    
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
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_agreement ON invoices(rental_agreement_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices(period_start, period_end);

-- Enable RLS
-- ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE invoices IS 'Monthly invoices for bot rental and service visits';
COMMENT ON COLUMN invoices.invoice_number IS 'Unique invoice number (INV-YYYYMM-NNNN)';
COMMENT ON COLUMN invoices.line_items IS 'Array of line items: [{description, quantity, unit_price, total}]';
COMMENT ON COLUMN invoices.status IS 'draft: not sent, sent: awaiting payment, paid: fully paid, overdue: past due, cancelled: voided, refunded: money returned';

-- Trigger to cascade delete payments when invoice is deleted
-- Payments reference invoice_number (TEXT), not invoice_id (UUID), so we need a trigger
CREATE OR REPLACE FUNCTION cleanup_payments_on_invoice_delete()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM payments WHERE invoice_number = OLD.invoice_number;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cleanup_payments_on_invoice_delete
    BEFORE DELETE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_payments_on_invoice_delete();

COMMENT ON FUNCTION cleanup_payments_on_invoice_delete 
IS 'Cascade delete payments when invoice is deleted (invoice_number is TEXT not FK)';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Invoices table created successfully';
    RAISE NOTICE 'Invoice format: INV-YYYYMM-NNNN';
    RAISE NOTICE 'Cascade delete trigger added for payments';
END $$;

