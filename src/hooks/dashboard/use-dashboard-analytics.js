import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Hook to fetch comprehensive dashboard analytics
 * Includes system health, bot stats, services, alerts, and more
 */
export function useDashboardAnalytics(organizationId, options = {}) {
  return useQuery({
    queryKey: ['dashboard-analytics-v2', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      const { data, error } = await supabase
        .rpc('get_dashboard_analytics_v2', {
          org_id: organizationId
        });

      if (error) {
        console.error('❌ Dashboard analytics error:', error);
        console.error('Error details:', {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        });
        // Don't throw - return default data instead so UI doesn't break
        return {
          system_health: { score: 0, uptime_percentage: 0, completion_rate: 0, efficiency: 0 },
          bots: { total: 0, operational: 0, charging: 0, offline: 0, errors: 0, active_now: 0, operational_percentage: 0 },
          services_today: { completed: 0, in_progress: 0, scheduled: 0, area_covered_sqm: 0, total_services: 0 },
          alerts: { total: 0, critical: 0, warning: 0, info: 0 },
          services: { total_area_sqm: 0, total_gardens: 0, total_pools: 0, total_services: 0 },
          locations: { total: 0 },
          monthly: { services_completed: 0, total_runtime_hours: 0 },
          upcoming: { next_service_date: null, count: 0 },
          completion_rate: { completed: 0, total: 0, percentage: 0 }
        };
      }
      
      // RPC returns array with single JSON object, or the JSON directly depending on Supabase version
      const analytics = Array.isArray(data) ? data[0] : data;
      
      console.log('✅ Dashboard analytics SUCCESS:', analytics);
      console.log('Organization ID used:', organizationId);
      
      return analytics || {
        system_health: { score: 0, uptime_percentage: 0, completion_rate: 0, efficiency: 0 },
        bots: { total: 0, operational: 0, charging: 0, offline: 0, errors: 0, active_now: 0, operational_percentage: 0 },
        services_today: { completed: 0, in_progress: 0, scheduled: 0, area_covered_sqm: 0, total_services: 0 },
        alerts: { total: 0, critical: 0, warning: 0, info: 0 },
        services: { total_area_sqm: 0, total_gardens: 0, total_pools: 0, total_services: 0 },
        locations: { total: 0 },
        monthly: { services_completed: 0, total_runtime_hours: 0 },
        upcoming: { next_service_date: null, count: 0 },
        completion_rate: { completed: 0, total: 0, percentage: 0 }
      };
    },
    enabled: !!organizationId,
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 20000, // Consider data stale after 20 seconds
    refetchOnWindowFocus: true, // Refetch when window regains focus
    refetchOnMount: true, // Refetch when component mounts
    ...options
  });
}

