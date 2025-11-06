import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Hook to fetch recent activity log
 * Returns recent events, alerts, and service completions
 */
export function useRecentActivity(organizationId, limit = 20, options = {}) {
  return useQuery({
    queryKey: ['recent-activity', organizationId, limit],
    queryFn: async () => {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      const { data, error } = await supabase
        .rpc('get_recent_activity_log', {
          org_id: organizationId,
          limit_count: limit
        });

      if (error) throw error;
      
      return data || [];
    },
    enabled: !!organizationId,
    refetchInterval: 15000, // Refresh every 15 seconds
    staleTime: 10000,
    refetchOnWindowFocus: true, // Refetch when window regains focus
    refetchOnMount: true, // Refetch when component mounts
    ...options
  });
}

