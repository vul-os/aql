-- =====================================================
-- Deposit Invoice Automation
-- =====================================================
-- Automatically create deposit invoice when rental agreement is signed
-- This allows immediate charging of setup fees upon bot installation
-- 
-- FEATURES:
-- - Initial Setup: Creates deposit invoice for all bots when first agreement signed
-- - Amendments: Automatically creates deposit invoice when gardens are added
-- - Smart Detection: Only charges for NEW bots not yet billed
-- - Prevents Duplicates: Tracks which bots already have deposits
-- 
-- Note: Invoices are created with status='sent' so that PDF generation
-- trigger can process them automatically (if PDF service is configured)

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
    v_total_bots_in_service INT;
    v_charged_bot_count INT;
    v_new_bots_count INT;
    v_setup_fee_per_bot DECIMAL;
    v_is_amendment BOOLEAN := FALSE;
    v_authorization RECORD;
    v_attempt_id UUID;
BEGIN
    -- Get rental agreement
    SELECT * INTO v_agreement
    FROM rental_agreements
    WHERE id = p_rental_agreement_id;
    
    IF v_agreement IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Rental agreement not found');
    END IF;
    
    -- Get organization legal profile for billing info
    SELECT * INTO v_profile
    FROM organization_legal_profiles
    WHERE organization_id = v_agreement.organization_id;
    
    -- Get setup fee from pricing (not hardcoded!)
    SELECT setup_fee INTO v_setup_fee_per_bot
    FROM pricing_plans
    WHERE bot_type = COALESCE(v_agreement.bot_type, 'mow_bot')
    AND is_active = true
    AND is_default = true
    LIMIT 1;
    
    -- Fallback if no pricing found
    IF v_setup_fee_per_bot IS NULL THEN
        v_setup_fee_per_bot := 299.00;
        RAISE NOTICE 'No pricing found, using default setup fee: R%', v_setup_fee_per_bot;
    END IF;
    
    -- Count TOTAL bots in the SERVICE (not just this one rental agreement)
    -- One service can have multiple rental agreements (one per garden)
    SELECT COUNT(*) INTO v_total_bots_in_service
    FROM rental_agreements
    WHERE service_id = v_agreement.service_id
    AND status = 'active';
    
    -- Count how many bots already have deposit invoices
    SELECT COALESCE(SUM((line_items->0->>'quantity')::INTEGER), 0) INTO v_charged_bot_count
    FROM invoices i
    JOIN rental_agreements ra ON i.rental_agreement_id = ra.id
    WHERE ra.service_id = v_agreement.service_id
    AND i.notes LIKE '%Deposit%'
    AND i.status != 'cancelled';
    
    -- Calculate number of NEW bots to charge for
    v_new_bots_count := v_total_bots_in_service - v_charged_bot_count;
    
    -- Determine if this is an amendment or initial setup
    IF v_charged_bot_count > 0 THEN
        v_is_amendment := TRUE;
        
        -- If no new bots to charge, skip invoice creation
        IF v_new_bots_count <= 0 THEN
            RETURN json_build_object(
                'success', false, 
                'error', 'All bots already have deposit invoices'
            );
        END IF;
    ELSE
        -- Initial setup - charge for all bots
        v_new_bots_count := v_total_bots_in_service;
    END IF;
    
    -- Calculate setup fee for NEW bots only
    v_setup_fee := v_setup_fee_per_bot * v_new_bots_count;
    
    -- Calculate tax (15% VAT)
    v_tax_amount := ROUND(v_setup_fee * 0.15, 2);
    v_total := v_setup_fee + v_tax_amount;
    
    -- Build line items for deposit invoice
    v_line_items := jsonb_build_array(
        jsonb_build_object(
            'description', CASE 
                WHEN v_is_amendment THEN 'Bot Setup Fee - Amendment (Refundable Deposit)'
                ELSE 'Bot Setup Fee (Refundable Deposit)'
            END,
            'details', 'Per bot: R' || v_setup_fee_per_bot || ' × ' || v_new_bots_count || ' bot' || 
                      CASE WHEN v_new_bots_count > 1 THEN 's' ELSE '' END ||
                      CASE WHEN v_is_amendment THEN ' (new)' ELSE '' END,
            'quantity', v_new_bots_count,
            'unit_price', v_setup_fee_per_bot,
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
        'sent', -- Set to 'sent' - PDF will be generated automatically by trigger
        CURRENT_DATE,
        CURRENT_DATE, -- Due immediately - will be picked up by auto_collect_payments() cron
        COALESCE(v_profile.first_name || ' ' || v_profile.surname, 'N/A'),
        COALESCE(v_profile.physical_address, 'N/A'),
        COALESCE(v_profile.physical_city, 'N/A'),
        COALESCE(v_profile.physical_province, 'N/A'),
        COALESCE(v_profile.physical_postal_code, 'N/A'),
        (SELECT email FROM profiles WHERE id = v_agreement.user_id),
        CASE 
            WHEN v_is_amendment THEN 'Deposit Invoice - Amendment Setup Fee for ' || v_new_bots_count || ' Additional Bot' || 
                CASE WHEN v_new_bots_count > 1 THEN 's' ELSE '' END || ' (Agreement: ' || v_agreement.agreement_number || ')'
            ELSE 'Deposit Invoice - Setup Fee for Bot Installation (Agreement: ' || v_agreement.agreement_number || ')'
        END
    )
    RETURNING id INTO v_invoice_id;
    
    RAISE NOTICE 'Deposit invoice % created for agreement % - creating payment attempt', 
                 v_invoice_number, v_agreement.agreement_number;
    
    -- Create payment attempt immediately for deposit invoices
    -- Get user's default payment authorization
    SELECT * INTO v_authorization
    FROM payment_authorizations
    WHERE user_id = v_agreement.user_id
    AND is_default = true
    AND is_active = true
    LIMIT 1;
    
    IF v_authorization IS NOT NULL THEN
        -- Create payment attempt with status='pending'
        -- This will trigger the charge-payment edge function automatically!
        BEGIN
            INSERT INTO payment_attempts (
                invoice_id,
                rental_agreement_id,
                user_id,
                organization_id,
                authorization_code,
                amount,
                attempt_number,
                status,
                next_retry_at
            )
            VALUES (
                v_invoice_id,
                p_rental_agreement_id,
                v_agreement.user_id,
                v_agreement.organization_id,
                v_authorization.authorization_code,
                v_total,
                1,
                'pending',
                CURRENT_TIMESTAMP + INTERVAL '1 day'
            )
            RETURNING id INTO v_attempt_id;
            
            RAISE NOTICE 'Payment attempt % created for deposit invoice % - edge function will process immediately', 
                        v_attempt_id, v_invoice_number;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE WARNING 'Failed to create payment attempt for deposit invoice %: %', v_invoice_number, SQLERRM;
        END;
    ELSE
        RAISE WARNING 'No payment authorization found for user % - invoice % will need manual payment', 
                     v_agreement.user_id, v_invoice_number;
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'total_amount', v_total,
        'setup_fee', v_setup_fee,
        'tax_amount', v_tax_amount,
        'due_date', CURRENT_DATE,
        'message', 'Deposit invoice created and payment attempt triggered'
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
    v_existing_count INT;
    v_charged_bot_count INT;
    v_total_bots_in_service INT;
    v_is_amendment BOOLEAN := FALSE;
BEGIN
    -- Only create deposit invoice when agreement becomes 'active'
    -- (This happens after signature is completed in backend)
    IF NEW.status = 'active' AND (OLD.status IS NULL OR OLD.status != 'active') THEN
        
        -- Count how many bots in this service already have deposit invoices
        SELECT COALESCE(SUM((line_items->0->>'quantity')::INTEGER), 0) INTO v_charged_bot_count
        FROM invoices i
        JOIN rental_agreements ra ON i.rental_agreement_id = ra.id
        WHERE ra.service_id = NEW.service_id
        AND i.notes LIKE '%Deposit%'
        AND i.status != 'cancelled';
        
        -- Count TOTAL active bots in the service
        SELECT COUNT(*) INTO v_total_bots_in_service
        FROM rental_agreements
        WHERE service_id = NEW.service_id
        AND status = 'active';
        
        -- If we've already charged for some bots, this is an amendment
        IF v_charged_bot_count > 0 THEN
            v_is_amendment := TRUE;
            
            -- Check if we have uncharged bots (amendment added new gardens)
            IF v_total_bots_in_service > v_charged_bot_count THEN
                RAISE NOTICE 'Amendment detected: % bots already charged, % total bots - creating deposit for % new bot(s)',
                            v_charged_bot_count,
                            v_total_bots_in_service,
                            v_total_bots_in_service - v_charged_bot_count;
            ELSE
                -- All bots already have deposits
                RAISE NOTICE 'Skipping deposit - all % bots already have deposits (agreement %)',
                            v_total_bots_in_service,
                            NEW.agreement_number;
                RETURN NEW;
            END IF;
        ELSE
            -- First rental agreement for this service
            RAISE NOTICE 'Creating initial deposit invoice for service (agreement %)', NEW.agreement_number;
        END IF;
        
        -- Create deposit invoice (will charge for ALL bots or just new ones)
        v_result := create_deposit_invoice(NEW.id);
        
        -- Log the result
        IF (v_result->>'success')::BOOLEAN THEN
            RAISE NOTICE 'OK %deposit invoice auto-created for agreement %: %', 
                        CASE WHEN v_is_amendment THEN 'Amendment ' ELSE '' END,
                        NEW.agreement_number, 
                        v_result->>'invoice_number';
        ELSE
            RAISE WARNING 'ERROR Failed to auto-create deposit invoice for agreement %: %', 
                         NEW.agreement_number, 
                         v_result->>'error';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on rental_agreements
-- Use CONSTRAINT TRIGGER to avoid firing for rolled-back transactions
DROP TRIGGER IF EXISTS auto_create_deposit_invoice_trigger ON rental_agreements;

CREATE CONSTRAINT TRIGGER auto_create_deposit_invoice_trigger
    AFTER INSERT OR UPDATE ON rental_agreements
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION trigger_create_deposit_invoice();

-- Grant permissions
GRANT EXECUTE ON FUNCTION create_deposit_invoice TO authenticated;
GRANT EXECUTE ON FUNCTION create_deposit_invoice TO postgres;

-- Comments
COMMENT ON FUNCTION create_deposit_invoice IS 'Creates deposit invoice with immediate due date (CURRENT_DATE) so auto_collect_payments() cron charges it immediately. Fetches setup_fee from pricing_plans table. Supports both initial setup and amendments - only charges for new bots not yet billed.';
COMMENT ON FUNCTION trigger_create_deposit_invoice IS 'Trigger function to auto-create deposit invoice when rental agreement becomes active. Handles both initial setup and amendments (additional gardens).';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== DEPOSIT INVOICE AUTOMATION CREATED ===';
    RAISE NOTICE 'Features:';
    RAISE NOTICE '  - Auto-creates deposit invoice when rental agreement is signed';
    RAISE NOTICE '  - Invoice includes setup fees for all new bots';
    RAISE NOTICE '  - Setup fee fetched from pricing_plans table (not hardcoded)';
    RAISE NOTICE '  - Supports amendments: charges deposit for newly added gardens/bots';
    RAISE NOTICE '  - Prevents duplicate charges: only bills for bots not yet charged';
    RAISE NOTICE '  - Due IMMEDIATELY - charged by auto_collect_payments() cron';
    RAISE NOTICE '  - Marked as "sent" - PDF generated automatically';
    RAISE NOTICE 'Flow:';
    RAISE NOTICE '  1. Customer signs rental agreement in frontend';
    RAISE NOTICE '  2. Backend creates rental_agreement with status="active"';
    RAISE NOTICE '  3. Trigger automatically creates deposit invoice';
    RAISE NOTICE '  4. PDF generation trigger creates PDF automatically';
    RAISE NOTICE '  5. Admin can charge invoice when bot is installed';
    RAISE NOTICE 'Amendment Flow:';
    RAISE NOTICE '  1. Customer adds more gardens to existing service';
    RAISE NOTICE '  2. New rental agreements created and become active';
    RAISE NOTICE '  3. Trigger detects amendment and creates deposit for NEW bots only';
    RAISE NOTICE '  4. Invoice clearly marked as "Amendment" deposit';
    RAISE NOTICE 'Manual Testing:';
    RAISE NOTICE '  -- Create invoice for existing agreement:';
    RAISE NOTICE '  SELECT create_deposit_invoice(''''<rental_agreement_id>'''');';
    RAISE NOTICE '  -- Check created invoices:';
    RAISE NOTICE '  SELECT invoice_number, total_amount, notes FROM invoices WHERE notes LIKE ''''%%Deposit%%'''';';
END $$;

