import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth-context';

/**
 * Role-Based Permissions Hook
 * 
 * Permissions are determined by role:
 * - owner: Full access
 * - admin: Almost full access
 * - manager: Manage services, bots, locations, view billing
 * - operator: View bots, services, analytics
 * - viewer: Read-only
 * - member: Basic view access
 */

const ROLE_PERMISSIONS = {
  owner: {
    manage_bots: true,
    manage_services: true,
    manage_locations: true,
    view_billing: true,
    manage_billing: true,
    manage_members: true,
    view_analytics: true,
    manage_settings: true,
    delete_organization: true,
  },
  admin: {
    manage_bots: true,
    manage_services: true,
    manage_locations: true,
    view_billing: true,
    manage_billing: true,
    manage_members: true,
    view_analytics: true,
    manage_settings: true,
    delete_organization: false,
  },
  manager: {
    manage_bots: true,
    manage_services: true,
    manage_locations: true,
    view_billing: true,
    manage_billing: false,
    manage_members: false,
    view_analytics: true,
    manage_settings: false,
    delete_organization: false,
  },
  operator: {
    manage_bots: false,
    manage_services: false,
    manage_locations: false,
    view_billing: false,
    manage_billing: false,
    manage_members: false,
    view_analytics: true,
    manage_settings: false,
    delete_organization: false,
  },
  viewer: {
    manage_bots: false,
    manage_services: false,
    manage_locations: false,
    view_billing: false,
    manage_billing: false,
    manage_members: false,
    view_analytics: true,
    manage_settings: false,
    delete_organization: false,
  },
  member: {
    manage_bots: false,
    manage_services: false,
    manage_locations: false,
    view_billing: false,
    manage_billing: false,
    manage_members: false,
    view_analytics: true,
    manage_settings: false,
    delete_organization: false,
  },
};

export function usePermissions(organizationId) {
  const { user } = useAuth();
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState({});

  useEffect(() => {
    if (!user || !organizationId) {
      setLoading(false);
      return;
    }

    loadUserRole();
  }, [user, organizationId]);

  const loadUserRole = async () => {
    try {
      const { data, error } = await supabase
        .from('organization_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .single();

      if (error) throw error;

      const userRole = data?.role || 'member';
      setRole(userRole);
      setPermissions(ROLE_PERMISSIONS[userRole] || ROLE_PERMISSIONS.member);
    } catch (error) {
      console.error('Error loading user role:', error);
      setRole('member');
      setPermissions(ROLE_PERMISSIONS.member);
    } finally {
      setLoading(false);
    }
  };

  const hasPermission = (permission) => {
    return permissions[permission] === true;
  };

  const isOwner = role === 'owner';
  const isAdmin = role === 'admin' || role === 'owner';
  const isManager = role === 'manager' || role === 'admin' || role === 'owner';

  return {
    role,
    permissions,
    hasPermission,
    isOwner,
    isAdmin,
    isManager,
    loading,
    
    // Specific permission checks
    canManageBots: hasPermission('manage_bots'),
    canManageServices: hasPermission('manage_services'),
    canManageLocations: hasPermission('manage_locations'),
    canViewBilling: hasPermission('view_billing'),
    canManageBilling: hasPermission('manage_billing'),
    canManageMembers: hasPermission('manage_members'),
    canViewAnalytics: hasPermission('view_analytics'),
    canManageSettings: hasPermission('manage_settings'),
    canDeleteOrganization: hasPermission('delete_organization'),
  };
}

/**
 * Usage Example:
 * 
 * const { canManageBots, canViewBilling, isAdmin, role } = usePermissions(organizationId);
 * 
 * if (canManageBots) {
 *   // Show bot management UI
 * }
 * 
 * if (isAdmin) {
 *   // Show admin controls
 * }
 */

