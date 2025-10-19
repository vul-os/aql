-- =====================================================
-- Service Amendment Implementation Trigger
-- =====================================================
-- Automatically implement approved amendments by creating gardens and rental agreements
-- This trigger fires when an amendment status changes to 'approved'

-- Function to implement approved amendment (add gardens)
CREATE OR REPLACE FUNCTION implement_approved_amendment()
RETURNS TRIGGER AS $$
DECLARE
    v_service RECORD;
    v_location_id UUID;
    v_organization_id UUID;
    v_user_id UUID;
    v_new_gardens_count INT;
    v_new_garden_ids UUID[];
    v_garden_id UUID;
    v_i INT;
    v_garden_name TEXT;
    v_garden_area INT;
    v_rental_agreement_result JSON;
BEGIN
    -- Only proceed if amendment was just approved
    IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
        
        -- Only handle 'add_gardens' for now
        IF NEW.amendment_type != 'add_gardens' THEN
            RAISE NOTICE 'Skipping implementation - amendment type % not yet supported', NEW.amendment_type;
            RETURN NEW;
        END IF;
        
        -- Get service details
        SELECT * INTO v_service
        FROM services
        WHERE id = NEW.service_id;
        
        IF NOT FOUND THEN
            RAISE WARNING 'Service not found for amendment %', NEW.id;
            RETURN NEW;
        END IF;
        
        v_location_id := v_service.location_id;
        v_organization_id := v_service.organization_id;
        v_user_id := NEW.user_id;
        
        -- Calculate how many new gardens to create
        v_new_gardens_count := NEW.new_garden_count - NEW.current_garden_count;
        
        IF v_new_gardens_count <= 0 THEN
            RAISE NOTICE 'No new gardens to create for amendment %', NEW.id;
            UPDATE service_amendments 
            SET status = 'implemented', implemented_at = NOW()
            WHERE id = NEW.id;
            RETURN NEW;
        END IF;
        
        RAISE NOTICE 'Implementing amendment %: creating % new garden(s)', NEW.id, v_new_gardens_count;
        
        -- Create the new gardens
        v_new_garden_ids := ARRAY[]::UUID[];
        FOR v_i IN 1..v_new_gardens_count LOOP
            v_garden_name := 'Garden ' || (NEW.current_garden_count + v_i);
            v_garden_area := 100; -- Default area, can be updated later
            
            -- Insert new garden
            INSERT INTO gardens (
                service_id,
                location_id,
                name,
                area_sqm,
                created_at
            ) VALUES (
                NEW.service_id,
                v_location_id,
                v_garden_name,
                v_garden_area,
                NOW()
            ) RETURNING id INTO v_garden_id;
            
            v_new_garden_ids := array_append(v_new_garden_ids, v_garden_id);
            
            RAISE NOTICE 'Created garden: % (ID: %)', v_garden_name, v_garden_id;
            
            -- Create rental agreement for this garden using backend API
            -- Note: This will automatically trigger deposit invoice creation
            -- when the rental agreement status is set to 'active'
            
            -- Create rental agreement for the new garden
            -- Copy from existing agreement but for new garden
            -- IMPORTANT: Rental agreements NEVER include service fee (only bot rental)
            -- Service fee is charged on monthly INVOICES, not on rental agreements
            -- This will automatically trigger deposit invoice creation when set to 'active'
            INSERT INTO rental_agreements (
                user_id,
                organization_id,
                location_id,
                service_id,
                garden_id,
                bot_type,
                number_of_bots,
                services_per_month,
                monthly_total,
                bot_rental_total,
                service_total,
                setup_fee,
                signer_first_name,
                signer_surname,
                signer_id_number,
                signer_address,
                signer_city,
                signer_province,
                signer_phone,
                signer_email,
                signature_image_url,
                signature_ip_address,
                signature_user_agent,
                signed_at,
                status,
                agreement_number,
                billing_day,
                created_at
            )
            SELECT 
                v_user_id,
                v_organization_id,
                v_location_id,
                NEW.service_id,
                v_garden_id, -- New garden
                ra.bot_type,
                1, -- 1 bot per garden
                ra.services_per_month,
                ra.bot_rental_total, -- FIXED: Only bot rental, no service fee (R150 not R550)
                ra.bot_rental_total, -- Bot rental total
                0, -- FIXED: No service fee for amendment gardens
                ra.setup_fee,
                ra.signer_first_name,
                ra.signer_surname,
                ra.signer_id_number,
                ra.signer_address,
                ra.signer_city,
                ra.signer_province,
                ra.signer_phone,
                ra.signer_email,
                NEW.signature_url, -- Amendment signature
                NEW.signature_ip_address,
                NEW.signature_user_agent,
                NEW.signed_at,
                'active', -- Set to active immediately - will trigger deposit invoice
                'RA-AMD-' || EXTRACT(YEAR FROM NOW()) || '-' || LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0'),
                ra.billing_day,
                NOW()
            FROM rental_agreements ra
            WHERE ra.service_id = NEW.service_id
            AND ra.status = 'active'
            LIMIT 1; -- Use existing agreement as template
            
            RAISE NOTICE 'Created rental agreement for garden %', v_garden_id;
        END LOOP;
        
        -- Update service to reflect new garden count
        UPDATE services
        SET updated_at = NOW()
        WHERE id = NEW.service_id;
        
        -- Mark amendment as implemented
        UPDATE service_amendments
        SET 
            status = 'implemented',
            implemented_at = NOW(),
            implementation_notes = format('Successfully created %s new garden(s) and rental agreement(s)', v_new_gardens_count)
        WHERE id = NEW.id;
        
        RAISE NOTICE '✅ Amendment % implemented successfully: % new gardens created', NEW.id, v_new_gardens_count;
        
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on service_amendments
DROP TRIGGER IF EXISTS auto_implement_amendment_trigger ON service_amendments;

CREATE TRIGGER auto_implement_amendment_trigger
    AFTER UPDATE ON service_amendments
    FOR EACH ROW
    EXECUTE FUNCTION implement_approved_amendment();

-- Grant permissions
GRANT EXECUTE ON FUNCTION implement_approved_amendment TO authenticated;
GRANT EXECUTE ON FUNCTION implement_approved_amendment TO postgres;

-- Comments
COMMENT ON FUNCTION implement_approved_amendment IS 'Automatically implements approved amendments by creating gardens, rental agreements, and triggering deposit invoices';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== AMENDMENT IMPLEMENTATION TRIGGER CREATED ===';
    RAISE NOTICE 'Features:';
    RAISE NOTICE '  - Auto-creates gardens when amendment is approved';
    RAISE NOTICE '  - Creates rental agreements for new gardens';
    RAISE NOTICE '  - Sets rental agreements to active (triggers deposit invoice)';
    RAISE NOTICE '  - Marks amendment as implemented automatically';
    RAISE NOTICE '';
    RAISE NOTICE 'Flow:';
    RAISE NOTICE '  1. Admin approves amendment in frontend';
    RAISE NOTICE '  2. Trigger detects status change to approved';
    RAISE NOTICE '  3. Creates N new gardens (where N = new_count - current_count)';
    RAISE NOTICE '  4. Creates rental agreement for each new garden';
    RAISE NOTICE '  5. Sets rental agreements to active';
    RAISE NOTICE '  6. Deposit invoice trigger creates invoice for new bots';
    RAISE NOTICE '  7. Amendment marked as implemented';
    RAISE NOTICE '';
    RAISE NOTICE 'This fixes the issue where approvals did not update billing/invoices!';
END $$;

