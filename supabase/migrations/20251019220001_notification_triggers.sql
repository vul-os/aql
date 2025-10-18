-- =====================================================
-- AUTOMATIC NOTIFICATION TRIGGERS
-- Database triggers that automatically send notifications
-- when certain events occur
-- =====================================================

-- =====================================================
-- HELPER FUNCTION: Get organization members
-- =====================================================
CREATE OR REPLACE FUNCTION get_organization_members(p_organization_id UUID)
RETURNS TABLE (user_id UUID, email TEXT, first_name TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.email,
        COALESCE(p.first_name, SPLIT_PART(p.email, '@', 1)) as first_name
    FROM organization_members om
    JOIN profiles p ON p.id = om.user_id
    WHERE om.organization_id = p_organization_id
        AND om.status = 'active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRIGGER 1: Bot Goes Offline
-- =====================================================
CREATE OR REPLACE FUNCTION notify_bot_status_change()
RETURNS TRIGGER AS $$
DECLARE
    v_member RECORD;
    v_bot_name TEXT;
    v_location RECORD;
BEGIN
    -- Only trigger if status changed to 'offline' or 'error'
    IF NEW.status IN ('offline', 'error') AND (OLD.status IS NULL OR OLD.status NOT IN ('offline', 'error')) THEN
        
        -- Get bot name
        v_bot_name := NEW.name;
        
        -- Get location details
        SELECT l.name, l.organization_id INTO v_location
        FROM locations l
        WHERE l.id = NEW.location_id;
        
        -- Send notification to all organization members
        FOR v_member IN 
            SELECT * FROM get_organization_members(v_location.organization_id)
        LOOP
            PERFORM create_notification(
                p_user_id := v_member.user_id,
                p_type := 'bot_offline',
                p_title := format('Bot Offline: %s', v_bot_name),
                p_message := format('Bot %s at %s has gone %s and is not responding.', 
                    v_bot_name, v_location.name, NEW.status),
                p_priority := 'urgent',
                p_organization_id := v_location.organization_id,
                p_related_type := 'bot',
                p_related_id := NEW.id,
                p_action_url := format('/portal/services'),
                p_action_label := 'View Services',
                p_send_email := true,
                p_send_push := true
            );
        END LOOP;
        
        RAISE NOTICE 'Bot offline notification sent for %', v_bot_name;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for bot status changes
DROP TRIGGER IF EXISTS trigger_bot_status_notification ON bots;
CREATE TRIGGER trigger_bot_status_notification
    AFTER UPDATE OF status ON bots
    FOR EACH ROW
    EXECUTE FUNCTION notify_bot_status_change();

-- =====================================================
-- TRIGGER 2: Low Battery Alert
-- =====================================================
CREATE OR REPLACE FUNCTION notify_bot_low_battery()
RETURNS TRIGGER AS $$
DECLARE
    v_member RECORD;
    v_bot RECORD;
    v_location RECORD;
    v_battery_level NUMERIC;
    v_old_battery_level NUMERIC;
BEGIN
    -- Only process battery telemetry
    IF NEW.telemetry_type = 'battery' THEN
        -- Extract battery level from JSONB data
        v_battery_level := (NEW.data->>'level')::NUMERIC;
        
        -- Get old battery level if this is an update
        IF TG_OP = 'UPDATE' AND OLD.telemetry_type = 'battery' THEN
            v_old_battery_level := (OLD.data->>'level')::NUMERIC;
        END IF;
        
        -- Only trigger if battery is low (< 20%) and wasn't low before
        IF v_battery_level IS NOT NULL AND v_battery_level < 20 
           AND (v_old_battery_level IS NULL OR v_old_battery_level >= 20) THEN
            
            -- Get bot details
            SELECT b.name, b.location_id INTO v_bot
            FROM bots b
            WHERE b.id = NEW.bot_id;
            
            -- Get location details
            SELECT l.name, l.organization_id INTO v_location
            FROM locations l
            WHERE l.id = v_bot.location_id;
            
            -- Send notification to all organization members
            FOR v_member IN 
                SELECT * FROM get_organization_members(v_location.organization_id)
            LOOP
                PERFORM create_notification(
                    p_user_id := v_member.user_id,
                    p_type := 'bot_low_battery',
                    p_title := format('Low Battery: %s', v_bot.name),
                    p_message := format('Bot %s battery level is at %s%%. Please charge soon.', 
                        v_bot.name, v_battery_level),
                    p_priority := CASE 
                        WHEN v_battery_level < 10 THEN 'high'
                        ELSE 'normal'
                    END,
                    p_organization_id := v_location.organization_id,
                    p_related_type := 'bot',
                    p_related_id := NEW.bot_id,
                    p_action_url := format('/portal/services'),
                    p_action_label := 'View Bot',
                    p_data := jsonb_build_object('battery_level', v_battery_level),
                    p_send_email := true,
                    p_send_push := true
                );
            END LOOP;
            
            RAISE NOTICE 'Low battery notification sent for bot %', v_bot.name;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for bot telemetry (battery updates)
DROP TRIGGER IF EXISTS trigger_bot_battery_notification ON bot_telemetry;
CREATE TRIGGER trigger_bot_battery_notification
    AFTER INSERT OR UPDATE ON bot_telemetry
    FOR EACH ROW
    WHEN (NEW.telemetry_type = 'battery')
    EXECUTE FUNCTION notify_bot_low_battery();

-- =====================================================
-- TRIGGER 3: Service Created/Scheduled
-- =====================================================
CREATE OR REPLACE FUNCTION notify_service_created()
RETURNS TRIGGER AS $$
DECLARE
    v_member RECORD;
    v_location RECORD;
BEGIN
    -- Only trigger on INSERT
    IF TG_OP = 'INSERT' THEN
        
        -- Get location details
        SELECT l.name, l.organization_id INTO v_location
        FROM locations l
        WHERE l.id = NEW.location_id;
        
        -- Send notification to all organization members
        FOR v_member IN 
            SELECT * FROM get_organization_members(v_location.organization_id)
        LOOP
            PERFORM create_notification(
                p_user_id := v_member.user_id,
                p_type := 'service_scheduled',
                p_title := 'New Service Scheduled',
                p_message := format('A new %s service has been scheduled at %s.', 
                    NEW.service_type, v_location.name),
                p_priority := 'normal',
                p_organization_id := v_location.organization_id,
                p_related_type := 'service',
                p_related_id := NEW.id,
                p_action_url := format('/portal/service/%s', NEW.id),
                p_action_label := 'View Service',
                p_send_email := true,
                p_send_push := true
            );
        END LOOP;
        
        RAISE NOTICE 'Service created notification sent for service %', NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for service creation
DROP TRIGGER IF EXISTS trigger_service_created_notification ON services;
CREATE TRIGGER trigger_service_created_notification
    AFTER INSERT ON services
    FOR EACH ROW
    EXECUTE FUNCTION notify_service_created();

-- =====================================================
-- TRIGGER 4: Service Completed
-- =====================================================
CREATE OR REPLACE FUNCTION notify_service_completed()
RETURNS TRIGGER AS $$
DECLARE
    v_member RECORD;
    v_location RECORD;
BEGIN
    -- Only trigger when status changes to 'completed'
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
        
        -- Get location details
        SELECT l.name, l.organization_id INTO v_location
        FROM locations l
        WHERE l.id = NEW.location_id;
        
        -- Send notification to all organization members
        FOR v_member IN 
            SELECT * FROM get_organization_members(v_location.organization_id)
        LOOP
            PERFORM create_notification(
                p_user_id := v_member.user_id,
                p_type := 'service_completed',
                p_title := 'Service Completed',
                p_message := format('Your %s service at %s has been completed successfully.', 
                    NEW.service_type, v_location.name),
                p_priority := 'low',
                p_organization_id := v_location.organization_id,
                p_related_type := 'service',
                p_related_id := NEW.id,
                p_action_url := format('/portal/service/%s', NEW.id),
                p_action_label := 'View Report',
                p_send_email := true,
                p_send_push := false,
                p_data := jsonb_build_object(
                    'completed_at', NEW.updated_at
                )
            );
        END LOOP;
        
        RAISE NOTICE 'Service completed notification sent for service %', NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for service completion
DROP TRIGGER IF EXISTS trigger_service_completed_notification ON services;
CREATE TRIGGER trigger_service_completed_notification
    AFTER UPDATE OF status ON services
    FOR EACH ROW
    EXECUTE FUNCTION notify_service_completed();

-- =====================================================
-- TRIGGER 5: Payment Failed
-- =====================================================
CREATE OR REPLACE FUNCTION notify_payment_failed()
RETURNS TRIGGER AS $$
DECLARE
    v_invoice RECORD;
    v_user RECORD;
BEGIN
    -- Only trigger when payment fails
    IF NEW.status = 'failed' AND (OLD.status IS NULL OR OLD.status != 'failed') THEN
        
        -- Get invoice details
        SELECT i.*, o.id as organization_id, o.name as organization_name
        INTO v_invoice
        FROM invoices i
        JOIN organizations o ON o.id = i.organization_id
        WHERE i.id = NEW.invoice_id;
        
        -- Get user details
        SELECT * INTO v_user FROM profiles WHERE id = NEW.user_id;
        
        -- Send notification to user
        PERFORM create_notification(
            p_user_id := NEW.user_id,
            p_type := 'payment_failed',
            p_title := 'Payment Failed',
            p_message := format('Your payment of R%s for invoice %s failed. Please update your payment method.', 
                v_invoice.total_amount, v_invoice.invoice_number),
            p_priority := 'urgent',
            p_organization_id := v_invoice.organization_id,
            p_related_type := 'invoice',
            p_related_id := NEW.invoice_id,
            p_action_url := format('/portal/billing'),
            p_action_label := 'Update Payment Method',
            p_data := jsonb_build_object(
                'amount', v_invoice.total_amount,
                'invoice_number', v_invoice.invoice_number,
                'error_message', NEW.error_message
            ),
            p_send_email := true,
            p_send_push := true
        );
        
        RAISE NOTICE 'Payment failed notification sent for invoice %', v_invoice.invoice_number;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for payment failures
DROP TRIGGER IF EXISTS trigger_payment_failed_notification ON payment_attempts;
CREATE TRIGGER trigger_payment_failed_notification
    AFTER UPDATE OF status ON payment_attempts
    FOR EACH ROW
    EXECUTE FUNCTION notify_payment_failed();

-- =====================================================
-- TRIGGER 6: New Member Joined
-- =====================================================
CREATE OR REPLACE FUNCTION notify_member_joined()
RETURNS TRIGGER AS $$
DECLARE
    v_member RECORD;
    v_new_user RECORD;
    v_organization RECORD;
BEGIN
    -- Only trigger on INSERT with 'active' status
    IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
        
        -- Get new user details
        SELECT * INTO v_new_user FROM profiles WHERE id = NEW.user_id;
        
        -- Get organization details
        SELECT * INTO v_organization FROM organizations WHERE id = NEW.organization_id;
        
        -- Send notification to all OTHER organization members
        FOR v_member IN 
            SELECT * FROM get_organization_members(NEW.organization_id)
            WHERE user_id != NEW.user_id  -- Don't notify the new member themselves
        LOOP
            PERFORM create_notification(
                p_user_id := v_member.user_id,
                p_type := 'member_joined',
                p_title := 'New Team Member',
                p_message := format('%s has joined your organization.', 
                    v_new_user.first_name),
                p_priority := 'low',
                p_organization_id := NEW.organization_id,
                p_related_type := 'organization',
                p_related_id := NEW.organization_id,
                p_action_url := '/portal/members',
                p_action_label := 'View Team',
                p_data := jsonb_build_object(
                    'new_user_email', v_new_user.email,
                    'new_user_role', NEW.role
                ),
                p_send_email := true,
                p_send_push := true
            );
        END LOOP;
        
        RAISE NOTICE 'Member joined notification sent for %', v_new_user.email;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new members
DROP TRIGGER IF EXISTS trigger_member_joined_notification ON organization_members;
CREATE TRIGGER trigger_member_joined_notification
    AFTER INSERT ON organization_members
    FOR EACH ROW
    EXECUTE FUNCTION notify_member_joined();

-- =====================================================
-- TRIGGER 7: Bot Emergency Stop / Command Issued
-- =====================================================
CREATE OR REPLACE FUNCTION notify_bot_emergency_command()
RETURNS TRIGGER AS $$
DECLARE
    v_member RECORD;
    v_bot RECORD;
    v_location RECORD;
BEGIN
    -- Only trigger for emergency stop commands
    IF NEW.command_type = 'emergency_stop' THEN
        
        -- Get bot details
        SELECT b.name, b.location_id INTO v_bot
        FROM bots b
        WHERE b.id = NEW.bot_id;
        
        -- Get location details
        SELECT l.name, l.organization_id INTO v_location
        FROM locations l
        WHERE l.id = v_bot.location_id;
        
        -- Send urgent notification to all organization members
        FOR v_member IN 
            SELECT * FROM get_organization_members(v_location.organization_id)
        LOOP
            PERFORM create_notification(
                p_user_id := v_member.user_id,
                p_type := 'bot_alert',
                p_title := format('🚨 Emergency Stop: %s', v_bot.name),
                p_message := format('Emergency stop activated for bot %s at %s.', 
                    v_bot.name, v_location.name),
                p_priority := 'urgent',
                p_organization_id := v_location.organization_id,
                p_related_type := 'bot',
                p_related_id := NEW.bot_id,
                p_action_url := '/portal/services',
                p_action_label := 'View Bot',
                p_send_email := true,
                p_send_push := true
            );
        END LOOP;
        
        RAISE NOTICE 'Emergency stop notification sent for bot %', v_bot.name;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for bot commands
DROP TRIGGER IF EXISTS trigger_bot_emergency_notification ON bot_commands;
CREATE TRIGGER trigger_bot_emergency_notification
    AFTER INSERT ON bot_commands
    FOR EACH ROW
    WHEN (NEW.command_type = 'emergency_stop')
    EXECUTE FUNCTION notify_bot_emergency_command();

-- =====================================================
-- TRIGGER 8: Amendment Submitted (Notify Admins)
-- =====================================================
CREATE OR REPLACE FUNCTION notify_amendment_submitted()
RETURNS TRIGGER AS $$
DECLARE
    v_member RECORD;
    v_service RECORD;
    v_user RECORD;
    v_organization_id UUID;
BEGIN
    -- Only trigger on INSERT
    IF TG_OP = 'INSERT' THEN
        
        -- Get service and organization details
        SELECT s.*, s.organization_id INTO v_service
        FROM services s
        WHERE s.id = NEW.service_id;
        
        v_organization_id := v_service.organization_id;
        
        -- Get user details
        SELECT * INTO v_user FROM profiles WHERE id = NEW.user_id;
        
        -- Send notification to all organization members (admins)
        FOR v_member IN 
            SELECT * FROM get_organization_members(v_organization_id)
        LOOP
            PERFORM create_notification(
                p_user_id := v_member.user_id,
                p_type := 'service_amendment_submitted',
                p_title := 'New Amendment Request',
                p_message := format('%s has requested to %s (%s → %s gardens) for service at %s.', 
                    v_user.first_name,
                    CASE 
                        WHEN NEW.amendment_type = 'add_gardens' THEN 'add gardens'
                        WHEN NEW.amendment_type = 'remove_gardens' THEN 'remove gardens'
                        ELSE 'change service frequency'
                    END,
                    NEW.current_garden_count,
                    NEW.new_garden_count,
                    v_service.name
                ),
                p_priority := 'normal',
                p_organization_id := v_organization_id,
                p_related_type := 'service',
                p_related_id := NEW.service_id,
                p_action_url := '/portal/admin/approvals',
                p_action_label := 'Review Amendment',
                p_data := jsonb_build_object(
                    'amendment_id', NEW.id,
                    'amendment_type', NEW.amendment_type,
                    'current_count', NEW.current_garden_count,
                    'new_count', NEW.new_garden_count
                ),
                p_send_email := true,
                p_send_push := true
            );
        END LOOP;
        
        RAISE NOTICE 'Amendment submitted notification sent to admins for amendment %', NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for amendment submission
DROP TRIGGER IF EXISTS trigger_amendment_submitted_notification ON service_amendments;
CREATE TRIGGER trigger_amendment_submitted_notification
    AFTER INSERT ON service_amendments
    FOR EACH ROW
    EXECUTE FUNCTION notify_amendment_submitted();

-- =====================================================
-- TRIGGER 9: Amendment Approved/Rejected (Notify Customer)
-- =====================================================
CREATE OR REPLACE FUNCTION notify_amendment_status_changed()
RETURNS TRIGGER AS $$
DECLARE
    v_service RECORD;
    v_approver RECORD;
BEGIN
    -- Only trigger when status changes to 'approved' or 'rejected'
    IF NEW.status IN ('approved', 'rejected') AND (OLD.status IS NULL OR OLD.status NOT IN ('approved', 'rejected')) THEN
        
        -- Get service details
        SELECT s.*, s.organization_id INTO v_service
        FROM services s
        WHERE s.id = NEW.service_id;
        
        -- Get approver details (if any)
        IF NEW.approved_by IS NOT NULL THEN
            SELECT * INTO v_approver FROM profiles WHERE id = NEW.approved_by;
        END IF;
        
        -- Send notification to the user who submitted the amendment
        PERFORM create_notification(
            p_user_id := NEW.user_id,
            p_type := CASE 
                WHEN NEW.status = 'approved' THEN 'service_amendment_approved'
                ELSE 'service_amendment_rejected'
            END,
            p_title := format('Amendment Request %s', 
                CASE WHEN NEW.status = 'approved' THEN 'Approved ✓' ELSE 'Rejected' END
            ),
            p_message := format('Your request to %s (%s → %s gardens) for service at %s has been %s.%s', 
                CASE 
                    WHEN NEW.amendment_type = 'add_gardens' THEN 'add gardens'
                    WHEN NEW.amendment_type = 'remove_gardens' THEN 'remove gardens'
                    ELSE 'change service frequency'
                END,
                NEW.current_garden_count,
                NEW.new_garden_count,
                v_service.name,
                NEW.status,
                CASE 
                    WHEN NEW.status = 'rejected' AND NEW.rejection_reason IS NOT NULL 
                    THEN format(' Reason: %s', NEW.rejection_reason)
                    ELSE ''
                END
            ),
            p_priority := CASE 
                WHEN NEW.status = 'approved' THEN 'normal'
                ELSE 'low'
            END,
            p_organization_id := v_service.organization_id,
            p_related_type := 'service',
            p_related_id := NEW.service_id,
            p_action_url := format('/portal/service/%s', NEW.service_id),
            p_action_label := 'View Service',
            p_data := jsonb_build_object(
                'amendment_id', NEW.id,
                'amendment_type', NEW.amendment_type,
                'status', NEW.status,
                'approved_by', v_approver.email,
                'rejection_reason', NEW.rejection_reason
            ),
            p_send_email := true,
            p_send_push := true
        );
        
        RAISE NOTICE 'Amendment status notification sent to user % for amendment %', NEW.user_id, NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for amendment status changes
DROP TRIGGER IF EXISTS trigger_amendment_status_notification ON service_amendments;
CREATE TRIGGER trigger_amendment_status_notification
    AFTER UPDATE OF status ON service_amendments
    FOR EACH ROW
    EXECUTE FUNCTION notify_amendment_status_changed();

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON FUNCTION get_organization_members IS 'Helper function to get all active members of an organization';
COMMENT ON FUNCTION notify_bot_status_change IS 'Trigger function: Sends notification when bot goes offline or has error';
COMMENT ON FUNCTION notify_bot_low_battery IS 'Trigger function: Sends notification when bot battery drops below 20%';
COMMENT ON FUNCTION notify_service_created IS 'Trigger function: Sends notification when new service is created';
COMMENT ON FUNCTION notify_service_completed IS 'Trigger function: Sends notification when service is completed';
COMMENT ON FUNCTION notify_payment_failed IS 'Trigger function: Sends notification when payment fails';
COMMENT ON FUNCTION notify_member_joined IS 'Trigger function: Sends notification when new member joins organization';
COMMENT ON FUNCTION notify_bot_emergency_command IS 'Trigger function: Sends urgent notification on emergency stop';
COMMENT ON FUNCTION notify_amendment_submitted IS 'Trigger function: Sends notification to admins when amendment is submitted';
COMMENT ON FUNCTION notify_amendment_status_changed IS 'Trigger function: Sends notification to customer when amendment is approved/rejected';

-- Success message
DO $$ 
BEGIN 
    RAISE NOTICE '✓ Notification triggers created successfully!';
    RAISE NOTICE '  - Bot offline/error → automatic notification';
    RAISE NOTICE '  - Low battery → automatic notification';
    RAISE NOTICE '  - Service created → automatic notification';
    RAISE NOTICE '  - Service completed → automatic notification';
    RAISE NOTICE '  - Payment failed → automatic notification';
    RAISE NOTICE '  - Member joined → automatic notification';
    RAISE NOTICE '  - Emergency stop → automatic urgent notification';
    RAISE NOTICE '  - Amendment submitted → notify admins';
    RAISE NOTICE '  - Amendment approved/rejected → notify customer';
    RAISE NOTICE '';
    RAISE NOTICE '💡 Now any changes to these tables will automatically send notifications!';
END $$;

