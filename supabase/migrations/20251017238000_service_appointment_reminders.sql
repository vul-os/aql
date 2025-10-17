-- =====================================================
-- Service Appointment Reminders
-- Notify customers day before next service
-- =====================================================

-- Add next_service_date to services table
ALTER TABLE services
    ADD COLUMN IF NOT EXISTS next_service_date DATE;

-- Create index
CREATE INDEX IF NOT EXISTS idx_services_next_service_date ON services(next_service_date) WHERE next_service_date IS NOT NULL;

-- Function to send service reminders
CREATE OR REPLACE FUNCTION send_service_reminders()
RETURNS void AS $$
DECLARE
    v_service RECORD;
    v_member RECORD;
    v_notification_data JSONB;
BEGIN
    -- Find services with appointments tomorrow
    FOR v_service IN 
        SELECT 
            s.*,
            l.name AS location_name,
            l.city AS location_city,
            o.id AS organization_id,
            o.name AS organization_name
        FROM services s
        JOIN locations l ON l.id = s.location_id
        JOIN organizations o ON o.id = s.organization_id
        WHERE s.next_service_date = CURRENT_DATE + INTERVAL '1 day'
            AND s.is_active = true
            AND s.status = 'active'
    LOOP
        -- Get all organization members
        FOR v_member IN
            SELECT 
                p.id,
                p.email,
                p.first_name,
                p.surname
            FROM organization_members om
            JOIN profiles p ON p.id = om.user_id
            WHERE om.organization_id = v_service.organization_id
                AND om.status = 'active'
        LOOP
            -- Create notification for each member
            INSERT INTO notifications (
                user_id,
                title,
                message,
                type,
                related_type,
                related_id,
                data,
                is_read
            ) VALUES (
                v_member.id,
                'Service Reminder',
                format('Your %s service at %s is scheduled for tomorrow', 
                    v_service.service_type, 
                    v_service.location_name),
                'reminder',
                'service',
                v_service.id,
                jsonb_build_object(
                    'service_id', v_service.id,
                    'service_name', v_service.name,
                    'service_date', v_service.next_service_date,
                    'location_name', v_service.location_name
                ),
                false
            );
            
            RAISE NOTICE 'Notification created for user % about service %', v_member.email, v_service.name;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule cron job to run daily at 9 AM
SELECT cron.schedule(
    'service-appointment-reminders',
    '0 9 * * *',  -- Every day at 9 AM
    $$SELECT send_service_reminders()$$
);

-- Comments
COMMENT ON COLUMN services.next_service_date IS 'Date of next scheduled service appointment';
COMMENT ON FUNCTION send_service_reminders IS 'Sends reminder notifications to all org members for services scheduled tomorrow';

