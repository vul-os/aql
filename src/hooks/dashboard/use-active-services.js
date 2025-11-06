import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Hook to fetch currently active/running services
 * Includes real-time progress, battery levels, and ETAs
 */
export function useActiveServices(organizationId, options = {}) {
  return useQuery({
    queryKey: ['active-services-v2', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      const { data, error } = await supabase
        .rpc('get_active_services_v2', {
          org_id: organizationId
        });

      if (error) throw error;
      
      return data || [];
    },
    enabled: !!organizationId,
    refetchInterval: 10000, // Refresh every 10 seconds for live data
    staleTime: 5000, // Consider data stale after 5 seconds
    refetchOnWindowFocus: true, // Refetch when window regains focus
    refetchOnMount: true, // Refetch when component mounts
    ...options
  });
}

