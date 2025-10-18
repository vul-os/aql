-- =====================================================
-- Deposit Invoice Automation
-- =====================================================
-- Automatically create deposit invoice when rental agreement is signed
-- This allows immediate charging of setup fees upon bot installation

-- Function to create deposit invoice from rental agreement
CREATE OR REPLACE FUNCTION create_deposit_invoice(
    p_rental_agreement_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_agreement RECORD;
    v_profile RECORD;
    v_setup_fee DECIMAL;
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
    
    -- Check if deposit invoice already exists
    IF EXISTS (
        SELECT 1 FROM invoices 
        WHERE rental_agreement_id = p_rental_agreement_id 
        AND notes LIKE '%Deposit%'
        AND status != 'cancelled'
    ) THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'Deposit invoice already exists for this agreement'
        );
    END IF;
    
    -- Get organization legal profile for billing info
    SELECT * INTO v_profile
    FROM organization_legal_profiles
    WHERE organization_id = v_agreement.organization_id;
    
    -- Get setup fee (deposit amount)
    v_setup_fee := COALESCE(v_agreement.setup_fee, 299.00);
    
    -- Calculate tax (15% VAT)
    v_tax_amount := ROUND(v_setup_fee * 0.15, 2);
    v_total := v_setup_fee + v_tax_amount;
    
    -- Build line items for deposit invoice
    v_line_items := jsonb_build_array(
        jsonb_build_object(
            'description', 'Bot Setup Fee (Refundable Deposit)',
            'details', 'Per bot: R' || v_setup_fee || ' × ' || v_agreement.number_of_bots || ' bot' || 
                      CASE WHEN v_agreement.number_of_bots > 1 THEN 's' ELSE '' END,
            'quantity', v_agreement.number_of_bots,
            'unit_price', v_setup_fee / v_agreement.number_of_bots,
            'total', v_setup_fee
        )
    );
    
    -- Generate invoice number
    v_invoice_number := generate_invoice_number();
    
    -- Create deposit invoice
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
        billing_email,
        notes
    ) VALUES (
        v_invoice_number,
        v_agreement.user_id,
        v_agreement.organization_id,
        p_rental_agreement_id,
        CURRENT_DATE,
        CURRENT_DATE,
        0, -- No bot rental for deposit invoice
        0, -- No service visits for deposit invoice
        v_setup_fee,
        15.00,
        v_tax_amount,
        v_total,
        v_total, -- Initially unpaid
        v_line_items,
        'draft', -- Start as draft, becomes 'sent' when PDF generated
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '7 days', -- Due in 7 days
        COALESCE(v_profile.first_name || ' ' || v_profile.surname, 'N/A'),
        COALESCE(v_profile.physical_address, 'N/A'),
        COALESCE(v_profile.physical_city, 'N/A'),
        COALESCE(v_profile.physical_province, 'N/A'),
        COALESCE(v_profile.physical_postal_code, 'N/A'),
        (SELECT email FROM profiles WHERE id = v_agreement.user_id),
        'Deposit Invoice - Setup Fee for Bot Installation (Agreement: ' || v_agreement.agreement_number || ')'
    )
    RETURNING id INTO v_invoice_id;
    
    RAISE NOTICE 'Deposit invoice created: % for agreement: %', v_invoice_number, v_agreement.agreement_number;
    
    RETURN json_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'total_amount', v_total,
        'setup_fee', v_setup_fee,
        'tax_amount', v_tax_amount,
        'due_date', CURRENT_DATE + INTERVAL '7 days',
        'message', 'Deposit invoice created successfully'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'detail', 'Failed to create deposit invoice'
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger function to auto-create deposit invoice when rental agreement is active
CREATE OR REPLACE FUNCTION trigger_create_deposit_invoice()
RETURNS TRIGGER AS $$
DECLARE
    v_result JSON;
BEGIN
    -- Only create deposit invoice when agreement becomes 'active'
    -- (This happens after signature is completed in backend)
    IF NEW.status = 'active' AND (OLD.status IS NULL OR OLD.status != 'active') THEN
        -- Create deposit invoice asynchronously
        -- Note: This runs synchronously in the transaction
        v_result := create_deposit_invoice(NEW.id);
        
        -- Log the result
        IF (v_result->>'success')::BOOLEAN THEN
            RAISE NOTICE 'Deposit invoice auto-created for agreement %: %', 
                        NEW.agreement_number, 
                        v_result->>'invoice_number';
        ELSE
            RAISE WARNING 'Failed to auto-create deposit invoice for agreement %: %', 
                         NEW.agreement_number, 
                         v_result->>'error';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on rental_agreements
DROP TRIGGER IF EXISTS auto_create_deposit_invoice_trigger ON rental_agreements;

CREATE TRIGGER auto_create_deposit_invoice_trigger
    AFTER INSERT OR UPDATE ON rental_agreements
    FOR EACH ROW
    EXECUTE FUNCTION trigger_create_deposit_invoice();

-- Grant permissions
GRANT EXECUTE ON FUNCTION create_deposit_invoice TO authenticated;
GRANT EXECUTE ON FUNCTION create_deposit_invoice TO postgres;

-- Comments
COMMENT ON FUNCTION create_deposit_invoice IS 'Creates a deposit/setup fee invoice for a rental agreement';
COMMENT ON FUNCTION trigger_create_deposit_invoice IS 'Trigger function to auto-create deposit invoice when rental agreement becomes active';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== DEPOSIT INVOICE AUTOMATION CREATED ===';
    RAISE NOTICE 'Features:';
    RAISE NOTICE '  ✓ Auto-creates deposit invoice when rental agreement is signed';
    RAISE NOTICE '  ✓ Invoice includes setup fees for all bots';
    RAISE NOTICE '  ✓ Due in 7 days from agreement date';
    RAISE NOTICE '  ✓ Marked as "draft" until PDF generated';
    RAISE NOTICE 'Flow:';
    RAISE NOTICE '  1. Customer signs rental agreement in frontend';
    RAISE NOTICE '  2. Backend creates rental_agreement with status="active"';
    RAISE NOTICE '  3. Trigger automatically creates deposit invoice';
    RAISE NOTICE '  4. Frontend can then generate PDF via /api/generate-invoice-pdf';
    RAISE NOTICE '  5. Admin can charge invoice when bot is installed';
    RAISE NOTICE 'Manual Testing:';
    RAISE NOTICE '  -- Create invoice for existing agreement:';
    RAISE NOTICE '  SELECT create_deposit_invoice(''''<rental_agreement_id>'''');';
    RAISE NOTICE '  -- Check created invoices:';
    RAISE NOTICE '  SELECT invoice_number, total_amount, notes FROM invoices WHERE notes LIKE ''''%%Deposit%%'''';';
END $$;

