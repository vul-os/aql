import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  LayoutDashboard,
  Sprout,
  Settings,
  Users,
  Bot,
  Menu,
  ChevronDown,
  LogOut,
  Building, // swapped from Building2 for a fresher org icon
  Building2,
  CreditCard,
  Moon,
  Sun,
  Search,
  Calendar,
  MapPin,
  Plus,
  Loader2,
  Shield,
  Wrench,
  FileCheck
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/components/theme-provider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { OrganizationOnboarding } from '@/components/auth/OrganizationOnboarding';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import LocationWizard from '@/components/services/location-wizard';
import { NotificationCenter } from '@/components/notifications/notification-center';

export default function PortalLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    user, 
    signOut, 
    organizations, 
    selectedOrg, 
    locations, 
    selectedLocation, 
    orgLoading,
    loadUserOrganizations,
    loadOrganizationLocations,
    changeOrganization,
    changeLocation
  } = useAuth();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAddLocationDialog, setShowAddLocationDialog] = useState(false);
  const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false);
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const mainNavItems = [
    { icon: <LayoutDashboard className="h-5 w-5" />, label: 'Dashboard', path: '/portal' },
    { icon: <Sprout className="h-5 w-5" />, label: 'Services', path: '/portal/services' },
    { icon: <Users className="h-5 w-5" />, label: 'Members', path: '/portal/members' },
    { icon: <CreditCard className="h-5 w-5" />, label: 'Billing', path: '/portal/billing' },
  ];

  const adminNavItems = [
    { icon: <FileCheck className="h-5 w-5" />, label: 'Approvals', path: '/admin/approvals' },
    { icon: <Wrench className="h-5 w-5" />, label: 'Bot Management', path: '/admin/bot-management' },
  ];

  const bottomNavItems = [
    { icon: <Settings className="h-5 w-5" />, label: 'Settings', path: '/portal/settings' },
  ];

  // Load admin status
  useEffect(() => {
    const loadAdminStatus = async () => {
      if (!user) return;
      
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, is_admin')
          .eq('id', user.id)
          .single();
        
        setIsAdmin(profile?.is_admin === true || profile?.role === 'admin');
      } catch (error) {
        console.error('Error loading admin status:', error);
      }
    };
    
    loadAdminStatus();
  }, [user]);

  const handleOrgChange = (org) => {
    changeOrganization(org);
    toast({
      title: "Organization switched",
      description: `Now viewing ${org.organization_name}`,
    });
  };

  const handleLocationChange = (loc) => {
    changeLocation(loc);
    toast({
      title: 'Location selected',
      description: loc?.name || 'Location changed',
    });
  };

  const handleCreateOrganization = async (e) => {
    e.preventDefault();
    
    if (!newOrgName.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter an organization name",
        variant: "destructive"
      });
      return;
    }

    setCreatingOrg(true);
    try {
      const { data, error } = await supabase.rpc('create_organization', {
        p_user_id: user.id,
        p_organization_name: newOrgName.trim(),
        p_organization_type: 'residential'
      });

      if (error) throw error;

      toast({
        variant: 'success',
        title: "Organization Created! 🎉",
        description: `${newOrgName} has been created and you are the admin.`,
      });

      // Reload organizations and select the new one
      await loadUserOrganizations();

      setShowCreateOrgDialog(false);
      setNewOrgName('');
    } catch (error) {
      console.error('Error creating organization:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create organization",
        variant: "destructive"
      });
    } finally {
      setCreatingOrg(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/auth/login');
    } catch (error) {
      console.error('Sign out error:', error);
      toast({
        title: "Error",
        description: "Failed to sign out",
        variant: "destructive"
      });
    }
  };

  const isActivePath = (path) => {
    if (path === '/portal') {
      return location.pathname === '/portal' || location.pathname === '/portal/';
    }
    return location.pathname.startsWith(path);
  };

  const getUserInitials = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return user?.email?.[0]?.toUpperCase() || 'U';
  };

  const Sidebar = ({ mobile = false }) => (
    <div className="flex flex-col h-full bg-gradient-to-b from-white via-gray-50/50 to-white dark:from-botkorp-black dark:via-botkorp-black-light/40 dark:to-botkorp-black text-gray-900 dark:text-white border-r border-gray-200/60 dark:border-slate-700/40 relative shadow-[0_16px_48px_rgb(0,0,0,0.06)] dark:shadow-[0_16px_48px_rgb(0,0,0,0.3)]">
      {/* Premium ambient glow overlay */}
      <div 
        className="pointer-events-none absolute inset-0 opacity-[0.02] dark:opacity-[0.04]" 
        style={{ 
          backgroundImage: `
            radial-gradient(circle at 20% 25%, rgba(255,107,53,0.12) 0%, transparent 60%),
            radial-gradient(circle at 80% 75%, rgba(79,93,117,0.08) 0%, transparent 60%)
          `,
          backgroundSize: '100% 100%, 100% 100%' 
        }} 
      />

      {/* Premium Logo Section */}
      <div 
        className="relative p-5 border-b border-gray-200/60 dark:border-slate-700/40 flex items-center gap-3 cursor-pointer group overflow-hidden bg-gradient-to-br from-white via-white to-gray-50/80 dark:from-botkorp-black-light/40 dark:via-botkorp-black-light/20 dark:to-transparent flex-shrink-0"
        onClick={() => {
          navigate('/');
          if (mobile) setMobileMenuOpen(false);
        }}
      >
        {/* Enhanced shimmer effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-orange/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1200 ease-out" />
        
        {/* Premium Icon Badge */}
        <div className="relative group-hover:scale-110 transition-transform duration-500">
          <div className="absolute inset-0 bg-gradient-to-br from-botkorp-orange to-orange-600 rounded-xl blur-lg opacity-40 group-hover:opacity-60 transition-opacity duration-500" />
          <div className="relative flex items-center justify-center h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange via-orange-500 to-orange-600 shadow-[0_8px_24px_rgb(255,107,53,0.35)] group-hover:shadow-[0_12px_32px_rgb(255,107,53,0.45)] transition-all duration-500">
            <div className="absolute inset-0.5 rounded-xl bg-gradient-to-br from-white/25 to-transparent" />
            <Bot className="relative h-5 w-5 text-white drop-shadow-lg" />
          </div>
        </div>
        
        <div className="relative flex-1">
          <h1 className="text-base font-black tracking-tight bg-gradient-to-r from-gray-900 via-gray-800 to-gray-700 dark:from-white dark:via-gray-100 dark:to-gray-200 bg-clip-text text-transparent">
            Bot Korp
          </h1>
          <p className="text-[9px] text-gray-500/80 dark:text-gray-400/80 uppercase tracking-[0.15em] font-bold mt-0.5">
            Control Center
          </p>
        </div>
      </div>

      {/* Scrollable Content Area - Single unified scroll */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
      {/* Premium Main Navigation */}
      <nav className="px-3 py-5 space-y-2">
        <div className="px-3 mb-3">
          <p className="text-[10px] font-black text-gray-400/70 dark:text-gray-500/70 uppercase tracking-[0.15em]">
            Main Menu
          </p>
        </div>
        <div className="space-y-1.5">
          {mainNavItems.map((item) => (
            <button
              key={item.path}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all duration-500 group relative overflow-hidden ${
                isActivePath(item.path)
                  ? 'bg-gradient-to-br from-botkorp-orange via-orange-500 to-orange-600 text-white shadow-[0_8px_24px_rgb(255,107,53,0.35)] hover:shadow-[0_12px_32px_rgb(255,107,53,0.45)] scale-[1.02]'
                  : 'text-gray-700 dark:text-gray-300 bg-white/70 dark:bg-slate-800/40 shadow-[0_4px_12px_rgb(0,0,0,0.04)] dark:shadow-[0_4px_12px_rgb(0,0,0,0.15)] hover:shadow-[0_8px_20px_rgb(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgb(255,107,53,0.2)] hover:bg-white dark:hover:bg-slate-700/50 hover:text-gray-900 dark:hover:text-white hover:scale-[1.02]'
              }`}
              onClick={() => {
                navigate(item.path);
                if (mobile) setMobileMenuOpen(false);
              }}
            >
              {/* Inner glow for active state */}
              {isActivePath(item.path) && (
                <div className="absolute inset-0.5 rounded-xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
              )}
              
              {/* Subtle shine effect on hover for inactive items */}
              {!isActivePath(item.path) && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-orange/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
              )}
              
              {/* Icon container with soft background */}
              <span className={`relative flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-lg transition-all duration-300 ${
                isActivePath(item.path) 
                  ? 'bg-white/20 text-white scale-105 shadow-[0_2px_6px_rgba(255,255,255,0.2)]' 
                  : 'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-botkorp-slate-blue/20 dark:to-botkorp-slate-blue/10 text-gray-700 dark:text-botkorp-silver group-hover:from-botkorp-orange/20 group-hover:to-botkorp-orange/10 group-hover:text-botkorp-orange dark:group-hover:text-white group-hover:scale-105 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)] dark:shadow-none'
              }`}>
                {React.cloneElement(item.icon, { className: 'h-4 w-4' })}
              </span>
              
              {/* Label with better typography */}
              <span className={`flex-1 text-left font-semibold text-xs tracking-wide ${
                isActivePath(item.path) ? 'text-white' : ''
              }`}>
                {item.label}
              </span>

              {/* Refined dot indicator for active */}
              {isActivePath(item.path) && (
                <div className="flex items-center justify-center h-5 w-5 rounded-lg bg-white/20">
                  <div className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_2px_6px_rgba(255,255,255,0.5)]" />
                </div>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Admin Section & Bottom Navigation - Soft UI design */}
      <div className="mt-auto pt-2">
        {/* Admin Navigation (only visible to admins) */}
        {isAdmin && (
          <div className="px-3 pb-3 pt-2">
            <div className="border-t border-gray-200/60 dark:border-botkorp-slate-blue/20 pt-3 pb-2">
              <div className="flex items-center gap-2 px-2 mb-2">
                <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-botkorp-slate-blue via-blue-600 to-blue-700 flex items-center justify-center shadow-[0_4px_12px_rgb(79,93,117,0.25)]">
                  <Shield className="h-3.5 w-3.5 text-white" />
                </div>
                <p className="text-[9px] font-bold text-gray-500/70 dark:text-botkorp-silver/60 uppercase tracking-widest">
                  Admin Tools
                </p>
              </div>
              <div className="space-y-1">
                {adminNavItems.map((item) => (
                  <button
                    key={item.path}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-300 group relative overflow-hidden ${
                      isActivePath(item.path)
                        ? 'bg-gradient-to-br from-botkorp-slate-blue via-blue-600 to-blue-700 text-white shadow-[0_4px_16px_rgb(79,93,117,0.3)] hover:shadow-[0_6px_20px_rgb(79,93,117,0.4)] scale-[1.01]'
                        : 'text-gray-700 dark:text-botkorp-silver bg-white/60 dark:bg-botkorp-black-light/30 shadow-[0_2px_6px_rgb(0,0,0,0.04)] dark:shadow-[0_2px_6px_rgb(0,0,0,0.1)] hover:shadow-[0_4px_10px_rgb(0,0,0,0.08)] dark:hover:shadow-[0_4px_10px_rgb(79,93,117,0.15)] hover:bg-white dark:hover:bg-botkorp-slate-blue/20 hover:text-gray-900 dark:hover:text-white hover:scale-[1.01]'
                    }`}
                    onClick={() => {
                      navigate(item.path);
                      if (mobile) setMobileMenuOpen(false);
                    }}
                  >
                    {/* Inner glow for active state */}
                    {isActivePath(item.path) && (
                      <div className="absolute inset-0.5 rounded-xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
                    )}
                    
                    {/* Subtle shine effect on hover for inactive items */}
                    {!isActivePath(item.path) && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-slate-blue/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                    )}
                    
                    <span className={`relative flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-lg transition-all duration-300 ${
                      isActivePath(item.path) 
                        ? 'bg-white/20 text-white scale-105 shadow-[0_2px_6px_rgba(255,255,255,0.2)]' 
                        : 'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-botkorp-slate-blue/20 dark:to-botkorp-slate-blue/10 text-gray-700 dark:text-botkorp-silver group-hover:from-botkorp-slate-blue/20 group-hover:to-botkorp-slate-blue/10 group-hover:text-botkorp-slate-blue dark:group-hover:text-white group-hover:scale-105 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)] dark:shadow-none'
                    }`}>
                      {React.cloneElement(item.icon, { className: 'h-4 w-4' })}
                    </span>
                    <span className={`flex-1 text-left font-semibold text-xs tracking-wide ${
                      isActivePath(item.path) ? 'text-white' : ''
                    }`}>
                      {item.label}
                    </span>
                    {isActivePath(item.path) && (
                      <div className="flex items-center justify-center h-5 w-5 rounded-lg bg-white/20">
                        <div className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_2px_6px_rgba(255,255,255,0.5)]" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Bottom Navigation - Settings & Organizations */}
        <div className="px-3 pb-3 border-t border-gray-200/60 dark:border-botkorp-slate-blue/20 pt-3 space-y-2">
        {/* Settings Button */}
        {bottomNavItems.map((item) => (
          <button
            key={item.path}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-300 group relative overflow-hidden ${
              isActivePath(item.path)
                ? 'bg-gradient-to-br from-botkorp-slate-blue via-blue-600 to-blue-700 text-white shadow-[0_4px_16px_rgb(79,93,117,0.3)] hover:shadow-[0_6px_20px_rgb(79,93,117,0.4)] scale-[1.01]'
                : 'text-gray-700 dark:text-botkorp-silver bg-white/60 dark:bg-botkorp-black-light/30 shadow-[0_2px_6px_rgb(0,0,0,0.04)] dark:shadow-[0_2px_6px_rgb(0,0,0,0.1)] hover:shadow-[0_4px_10px_rgb(0,0,0,0.08)] dark:hover:shadow-[0_4px_10px_rgb(79,93,117,0.15)] hover:bg-white dark:hover:bg-botkorp-slate-blue/20 hover:text-gray-900 dark:hover:text-white hover:scale-[1.01]'
            }`}
            onClick={() => {
              navigate(item.path);
              if (mobile) setMobileMenuOpen(false);
            }}
          >
            {/* Inner glow for active state */}
            {isActivePath(item.path) && (
              <div className="absolute inset-0.5 rounded-xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
            )}
            
            {/* Subtle shine effect on hover for inactive items */}
            {!isActivePath(item.path) && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-slate-blue/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            )}
            
            <span className={`relative flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-lg transition-all duration-300 ${
              isActivePath(item.path) 
                ? 'bg-white/20 text-white scale-105 shadow-[0_2px_6px_rgba(255,255,255,0.2)]' 
                : 'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-botkorp-slate-blue/20 dark:to-botkorp-slate-blue/10 text-gray-700 dark:text-botkorp-silver group-hover:from-botkorp-slate-blue/20 group-hover:to-botkorp-slate-blue/10 group-hover:text-botkorp-slate-blue dark:group-hover:text-white group-hover:scale-105 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)] dark:shadow-none'
            }`}>
              {React.cloneElement(item.icon, { className: 'h-4 w-4' })}
            </span>
            <span className={`flex-1 text-left font-semibold text-xs tracking-wide ${
              isActivePath(item.path) ? 'text-white' : ''
            }`}>
              {item.label}
            </span>
            {isActivePath(item.path) && (
              <div className="flex items-center justify-center h-5 w-5 rounded-lg bg-white/20">
                <div className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_2px_6px_rgba(255,255,255,0.5)]" />
              </div>
            )}
          </button>
        ))}

        {/* Organization Selector - Soft UI design */}
        <div className="pt-2 border-t border-gray-200/60 dark:border-botkorp-slate-blue/20">
          <div className="flex items-center gap-2 px-2 mb-2">
            <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-botkorp-orange via-orange-500 to-orange-600 flex items-center justify-center shadow-[0_4px_12px_rgb(255,107,53,0.25)]">
              <Building className="h-3.5 w-3.5 text-white" />
            </div>
            <p className="text-[9px] font-bold text-gray-500/70 dark:text-botkorp-silver/60 uppercase tracking-widest">
              Organizations
            </p>
          </div>
          
          {/* Current Organization Display */}
          <div className="space-y-1.5">
            {organizations.map((org) => (
              <button
                key={org.organization_id}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-300 group relative overflow-hidden ${
                  selectedOrg?.organization_id === org.organization_id
                    ? 'bg-gradient-to-br from-botkorp-orange/15 via-botkorp-orange/10 to-botkorp-orange/5 border border-botkorp-orange/40 shadow-[0_4px_12px_rgb(255,107,53,0.15)] scale-[1.01]'
                    : 'text-gray-700 dark:text-botkorp-silver bg-white/60 dark:bg-botkorp-black-light/30 shadow-[0_2px_6px_rgb(0,0,0,0.04)] dark:shadow-[0_2px_6px_rgb(0,0,0,0.1)] hover:shadow-[0_4px_10px_rgb(0,0,0,0.08)] dark:hover:shadow-[0_4px_10px_rgb(255,107,53,0.15)] hover:bg-white dark:hover:bg-botkorp-slate-blue/20 border border-transparent hover:scale-[1.01]'
                }`}
                onClick={() => {
                  handleOrgChange(org);
                  if (mobile) setMobileMenuOpen(false);
                }}
              >
                {/* Shine effect on selected */}
                {selectedOrg?.organization_id === org.organization_id && (
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-orange/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                )}
                
                <div className="flex items-center gap-2.5 relative">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold shadow-sm transition-all duration-300 ${
                    selectedOrg?.organization_id === org.organization_id
                      ? 'bg-gradient-to-br from-botkorp-orange via-orange-500 to-orange-600 text-white scale-105 shadow-[0_4px_10px_rgb(255,107,53,0.25)]'
                      : 'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-botkorp-slate-blue/20 dark:to-botkorp-slate-blue/10 text-gray-700 dark:text-botkorp-silver group-hover:from-botkorp-orange/20 group-hover:to-botkorp-orange/10 group-hover:text-botkorp-orange group-hover:scale-105 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)] dark:shadow-none'
                  }`}>
                    {org.organization_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate tracking-wide ${
                      selectedOrg?.organization_id === org.organization_id
                        ? 'text-gray-900 dark:text-white'
                        : 'text-gray-800 dark:text-white/90 group-hover:text-gray-900 dark:group-hover:text-white'
                    }`}>
                      {org.organization_name}
                    </p>
                    <p className={`text-[9px] capitalize tracking-wider font-medium ${
                      selectedOrg?.organization_id === org.organization_id
                        ? 'text-gray-600/80 dark:text-botkorp-silver/80'
                        : 'text-gray-500/70 dark:text-botkorp-silver/60'
                    }`}>
                      {org.member_role}
                    </p>
                  </div>
                  {selectedOrg?.organization_id === org.organization_id && (
                    <div className="flex items-center justify-center h-5 w-5 rounded-lg bg-botkorp-orange/20">
                      <div className="h-1.5 w-1.5 rounded-full bg-botkorp-orange shadow-[0_2px_6px_rgba(255,107,53,0.5)] animate-pulse" />
                    </div>
                  )}
                </div>
              </button>
            ))}
            
            {/* Create Organization Button */}
            <button
              className="w-full text-left px-3 py-2.5 rounded-xl transition-all duration-300 text-gray-700 dark:text-botkorp-silver bg-white/40 dark:bg-botkorp-black-light/20 shadow-[0_2px_6px_rgb(0,0,0,0.04)] dark:shadow-[0_2px_6px_rgb(0,0,0,0.1)] hover:shadow-[0_4px_10px_rgb(0,0,0,0.08)] dark:hover:shadow-[0_4px_10px_rgb(255,107,53,0.15)] hover:bg-botkorp-orange/10 hover:text-gray-900 dark:hover:text-white border border-dashed border-gray-300/60 dark:border-botkorp-slate-blue/30 hover:border-botkorp-orange hover:scale-[1.01] flex items-center gap-2.5 group relative overflow-hidden"
              onClick={() => setShowCreateOrgDialog(true)}
            >
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 dark:from-botkorp-slate-blue/20 dark:to-botkorp-slate-blue/10 flex items-center justify-center group-hover:from-botkorp-orange group-hover:to-orange-600 group-hover:text-white transition-all duration-300 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)] dark:shadow-none group-hover:shadow-[0_4px_10px_rgb(255,107,53,0.25)] group-hover:scale-105">
                <Plus className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-semibold group-hover:text-botkorp-orange transition-colors tracking-wide">
                Create Organization
              </span>
            </button>
          </div>
        </div>

        {/* Organization Info (mobile only) */}
        {mobile && selectedOrg && (
          <div className="pt-2 border-t border-gray-200/60 dark:border-botkorp-slate-blue/20">
            <div className="bg-gradient-to-br from-botkorp-orange/10 via-botkorp-orange/5 to-transparent rounded-xl p-3 border border-botkorp-orange/30 shadow-[0_4px_12px_rgb(255,107,53,0.12)]">
              <p className="text-[9px] text-gray-600/80 dark:text-botkorp-silver/80 mb-1 font-semibold uppercase tracking-wider">Current Organization</p>
              <p className="font-bold text-gray-900 dark:text-white text-xs">{selectedOrg.organization_name}</p>
              <p className="text-[10px] text-gray-500/80 dark:text-botkorp-silver/70 capitalize mt-0.5">{selectedOrg.member_role}</p>
            </div>
          </div>
        )}
        </div>
      </div>
      </div>
    </div>
  );

  if (orgLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!selectedOrg && !orgLoading) {
    return <OrganizationOnboarding onComplete={() => loadUserOrganizations()} />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop Sidebar - Elegant compact width */}
      <aside className="hidden md:block w-64 flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Premium Navbar */}
        <header className="sticky top-0 z-50 backdrop-blur-2xl bg-gradient-to-br from-white/95 via-white/90 to-gray-50/80 dark:from-botkorp-black/95 dark:via-botkorp-black/90 dark:to-slate-900/80 border-b border-gray-200/60 dark:border-slate-700/40 shadow-[0_8px_40px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.3)] relative overflow-hidden">
          
          {/* Enhanced ambient background */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-orange/8 to-transparent pointer-events-none" />
          
          <div className="relative flex items-center justify-between px-6 py-4 gap-4">
            {/* Premium Mobile Menu Button */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="md:hidden">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="group relative h-12 w-12 rounded-xl bg-white/80 dark:bg-slate-800/60 backdrop-blur-md border border-gray-200/60 dark:border-slate-700/50 shadow-[0_4px_16px_rgb(0,0,0,0.06)] hover:shadow-[0_8px_24px_rgb(255,107,53,0.2)] hover:bg-botkorp-orange hover:text-white hover:border-botkorp-orange transition-all duration-500 hover:scale-105"
                >
                  <Menu className="h-5 w-5 transition-all duration-300 group-hover:rotate-90" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-64 border-0 bg-white dark:bg-transparent">
                <Sidebar mobile />
              </SheetContent>
            </Sheet>

            {/* Premium Location Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="group relative gap-3 rounded-xl border border-gray-200/60 dark:border-slate-700/50 bg-white/80 dark:bg-slate-800/60 backdrop-blur-md shadow-[0_4px_16px_rgb(0,0,0,0.06)] hover:shadow-[0_8px_24px_rgb(255,107,53,0.15),0_0_0_3px_rgb(255,107,53,0.15)] hover:border-botkorp-orange/30 transition-all duration-500 h-12 px-4"
                >
                  {/* Premium location icon */}
                  <span className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-gradient-to-br from-botkorp-orange via-orange-500 to-orange-600 text-white text-sm font-black shadow-[0_6px_18px_rgba(255,107,53,0.3)] group-hover:shadow-[0_8px_24px_rgba(255,107,53,0.4)] group-hover:scale-110 transition-all duration-500" aria-hidden>
                    {selectedLocation?.name?.[0]?.toUpperCase() || 'L'}
                  </span>
                  
                  <div className="hidden sm:flex flex-col items-start">
                    <span className="text-[9px] text-muted-foreground/70 font-semibold leading-tight uppercase tracking-wider">
                      Location
                    </span>
                    <span className="text-sm font-bold text-foreground max-w-[140px] truncate leading-tight mt-0.5 group-hover:text-botkorp-orange transition-colors">
                      {selectedLocation?.name || 'Select location'}
                    </span>
                  </div>
                  
                  <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-botkorp-orange transition-all duration-300" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Locations</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(locations && locations.length > 0) ? (
                  locations.map((loc) => (
                    <DropdownMenuItem
                      key={loc.id}
                      onClick={() => handleLocationChange(loc)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        <div className="flex flex-col">
                          <span className="font-medium">{loc.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {loc.city || loc.address}
                          </span>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))
                ) : (
                  <div className="px-2 py-3 text-sm text-muted-foreground">No locations found</div>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowAddLocationDialog(true)}
                  className="cursor-pointer text-primary font-medium"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add New Location
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => navigate('/portal/settings?tab=locations')}
                  className="cursor-pointer"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Location Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Premium Search Bar */}
            <div className="hidden md:flex flex-1 mx-6">
              <div className="relative w-full max-w-xl group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 dark:text-gray-500 group-focus-within:text-botkorp-orange transition-colors duration-300" />
                <Input
                  placeholder="Search services, bots, locations..."
                  className="h-12 pl-12 pr-20 bg-white/80 dark:bg-slate-800/60 backdrop-blur-md border border-gray-200/60 dark:border-slate-700/50 shadow-[0_4px_16px_rgb(0,0,0,0.06)] focus:shadow-[0_8px_24px_rgb(255,107,53,0.15),0_0_0_3px_rgb(255,107,53,0.15)] focus:border-botkorp-orange/30 transition-all duration-500 rounded-xl font-medium"
                />
                {/* Search shortcut hint */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/50 border border-border/40 shadow-sm">
                  <span className="text-[10px] font-semibold text-muted-foreground">⌘K</span>
                </div>
              </div>
            </div>

            {/* Notifications & User Menu */}
            <div className="flex items-center gap-3">
              <NotificationCenter />
              
              {/* Premium User Avatar */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    className="group relative h-12 w-12 rounded-xl p-0 bg-white/80 dark:bg-slate-800/60 backdrop-blur-md border border-gray-200/60 dark:border-slate-700/50 shadow-[0_4px_16px_rgb(0,0,0,0.06)] hover:shadow-[0_8px_24px_rgb(255,107,53,0.15),0_0_0_3px_rgb(255,107,53,0.15)] hover:border-botkorp-orange/30 transition-all duration-500 hover:scale-105"
                  >
                    {/* Avatar */}
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={user?.user_metadata?.avatar_url} alt={user?.email} />
                      <AvatarFallback className="bg-gradient-to-br from-botkorp-orange via-orange-500 to-orange-600 text-white font-black text-sm">{getUserInitials()}</AvatarFallback>
                    </Avatar>
                    
                    {/* Enhanced active status indicator */}
                    <div className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-green-500 border-2 border-white dark:border-slate-800 shadow-[0_4px_12px_rgba(34,197,94,0.5)] animate-pulse" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">
                        {user?.user_metadata?.full_name || 'User'}
                      </p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {user?.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  
                  {/* Dark Mode Toggle */}
                  <div className="px-2 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {theme === 'dark' ? (
                          <Moon className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Sun className="h-4 w-4 text-muted-foreground" />
                        )}
                        <Label htmlFor="dark-mode" className="text-sm font-normal cursor-pointer">
                          Dark Mode
                        </Label>
                      </div>
                      <Switch
                        id="dark-mode"
                        checked={theme === 'dark'}
                        onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                      />
                    </div>
                  </div>
                  
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/portal/settings')}>
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Premium Page Content */}
        <main className="flex-1 overflow-y-auto bg-gradient-to-br from-gray-50 via-gray-50/80 to-white dark:from-botkorp-black dark:via-botkorp-black-light/40 dark:to-botkorp-black">
          <Outlet context={{ 
            selectedOrg,
            organization: selectedOrg ? {
              id: selectedOrg.organization_id,
              name: selectedOrg.organization_name,
              subscription_tier: selectedOrg.subscription_tier,
              role: selectedOrg.member_role
            } : null
          }} />
        </main>
      </div>

      {/* Add Location Dialog */}
      <Dialog open={showAddLocationDialog} onOpenChange={setShowAddLocationDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Add New Location
            </DialogTitle>
            <DialogDescription>
              Add a new location for {selectedOrg?.organization_name}
            </DialogDescription>
          </DialogHeader>
          <LocationWizard
            organizationId={selectedOrg?.organization_id}
            onComplete={(newLocation) => {
              setShowAddLocationDialog(false);
              loadOrganizationLocations();
              toast({
                variant: 'success',
                title: 'Location Added! 🎉',
                description: `${newLocation.name} has been added successfully.`,
              });
              // Auto-select the new location
              changeLocation(newLocation);
            }}
            onCancel={() => setShowAddLocationDialog(false)}
            embedded={true}
            showCancel={true}
            title=""
            description=""
          />
        </DialogContent>
      </Dialog>

      {/* Create Organization Dialog */}
      <Dialog open={showCreateOrgDialog} onOpenChange={setShowCreateOrgDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building className="h-5 w-5 text-primary" />
              Create New Organization
            </DialogTitle>
            <DialogDescription>
              Create a new organization. You'll be added as the admin automatically.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateOrganization} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="orgName">Organization Name *</Label>
              <Input
                id="orgName"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="My Company Name"
                required
                disabled={creatingOrg}
              />
              <p className="text-xs text-muted-foreground">
                This can be your company name, family name, or any identifier.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateOrgDialog(false)}
                disabled={creatingOrg}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creatingOrg}>
                {creatingOrg ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Organization
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

