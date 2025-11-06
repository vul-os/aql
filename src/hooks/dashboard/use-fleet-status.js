import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Hook to fetch fleet status breakdown
 * Returns counts for active, charging, idle, and needs attention
 */
export function useFleetStatus(organizationId, options = {}) {
  return useQuery({
    queryKey: ['fleet-status-v2', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      const { data, error } = await supabase
        .rpc('get_fleet_status_v2', {
          org_id: organizationId
        });

      if (error) throw error;
      
      return data || {
        total: 0,
        active_now: 0,
        charging: 0,
        idle: 0,
        needs_attention: 0,
        active_services: 0
      };
    },
    enabled: !!organizationId,
    refetchInterval: 15000, // Refresh every 15 seconds
    staleTime: 10000,
    refetchOnWindowFocus: true, // Refetch when window regains focus
    refetchOnMount: true, // Refetch when component mounts
    ...options
  });
}

