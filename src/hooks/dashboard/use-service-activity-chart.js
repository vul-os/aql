import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Hook to fetch service activity chart data
 * Returns daily service activity for the specified number of days
 */
export function useServiceActivityChart(organizationId, daysBack = 30, options = {}) {
  return useQuery({
    queryKey: ['service-activity-chart', organizationId, daysBack],
    queryFn: async () => {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      const { data, error } = await supabase
        .rpc('get_service_activity_chart_data', {
          org_id: organizationId,
          days_back: daysBack
        });

      if (error) throw error;
      
      return data || [];
    },
    enabled: !!organizationId,
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000,
    refetchOnWindowFocus: true, // Refetch when window regains focus
    refetchOnMount: true, // Refetch when component mounts
    ...options
  });
}

