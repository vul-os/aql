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
    <div className="flex flex-col h-full bg-white dark:bg-gradient-to-b dark:from-botkorp-black dark:via-botkorp-black-light dark:to-botkorp-slate-blue text-gray-900 dark:text-white border-r border-gray-200 dark:border-botkorp-slate-blue/30 relative shadow-2xl">
      {/* Subtle mesh gradient overlay */}
      <div 
        className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.04] opacity-0" 
        style={{ 
          backgroundImage: `
            radial-gradient(circle at 20% 50%, rgba(255,107,53,0.2) 0%, transparent 50%),
            radial-gradient(circle at 80% 80%, rgba(79,93,117,0.2) 0%, transparent 50%),
            radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)
          `,
          backgroundSize: '100% 100%, 100% 100%, 32px 32px' 
        }} 
      />

      {/* Logo Section - Professional header */}
      <div 
        className="relative p-4 border-b border-gray-200 dark:border-botkorp-slate-blue/30 flex items-center gap-2.5 cursor-pointer group overflow-hidden bg-gray-50 dark:bg-botkorp-black-light/50 flex-shrink-0"
        onClick={() => {
          navigate('/');
          if (mobile) setMobileMenuOpen(false);
        }}
      >
        {/* Hover shimmer effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-orange/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
        
        <div className="relative flex items-center justify-center h-10 w-10 rounded-lg bg-botkorp-orange shadow-lg shadow-botkorp-orange/30 ring-2 ring-botkorp-orange/20 group-hover:scale-105 group-hover:shadow-botkorp-orange/50 group-hover:ring-botkorp-orange/30 transition-all duration-300">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div className="relative flex-1">
          <h1 className="text-base font-bold tracking-tight text-gray-900 dark:text-white drop-shadow-sm">
            Bot Korp
          </h1>
          <p className="text-[9px] text-gray-600 dark:text-botkorp-silver uppercase tracking-widest font-semibold">
            Control Center
          </p>
        </div>
      </div>

      {/* Scrollable Content Area - Single unified scroll */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
      {/* Main Navigation - Professional design with better hierarchy */}
      <nav className="px-3 py-4 space-y-1">
        <div className="px-3 mb-2">
          <p className="text-[9px] font-bold text-gray-500 dark:text-botkorp-silver/60 uppercase tracking-widest">
            Main Menu
          </p>
        </div>
        <div className="space-y-0.5">
          {mainNavItems.map((item) => (
            <button
              key={item.path}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-300 group relative overflow-hidden ${
                isActivePath(item.path)
                  ? 'bg-botkorp-orange text-white shadow-lg shadow-botkorp-orange/30 scale-[1.01]'
                  : 'text-gray-700 dark:text-botkorp-silver hover:bg-gray-100 dark:hover:bg-botkorp-slate-blue/30 hover:text-gray-900 dark:hover:text-white hover:scale-[1.01]'
              }`}
              onClick={() => {
                navigate(item.path);
                if (mobile) setMobileMenuOpen(false);
              }}
            >
              {/* Subtle shine effect on hover for inactive items */}
              {!isActivePath(item.path) && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-orange/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
              )}
              
              {/* Active indicator bar - sleeker design */}
              {isActivePath(item.path) && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 bg-white rounded-r-full shadow-md" />
              )}
              
              {/* Icon container with backdrop */}
              <span className={`relative flex-shrink-0 flex items-center justify-center h-7 w-7 rounded-lg transition-all duration-300 ${
                isActivePath(item.path) 
                  ? 'bg-white/20 text-white scale-105' 
                  : 'bg-gray-200 dark:bg-botkorp-slate-blue/20 text-gray-700 dark:text-botkorp-silver group-hover:bg-botkorp-orange/20 group-hover:text-botkorp-orange dark:group-hover:text-white group-hover:scale-105'
              }`}>
                {React.cloneElement(item.icon, { className: 'h-4 w-4' })}
              </span>
              
              {/* Label with better typography */}
              <span className={`flex-1 text-left font-semibold text-xs tracking-wide ${
                isActivePath(item.path) ? 'text-white' : ''
              }`}>
                {item.label}
              </span>

              {/* Refined chevron indicator */}
              {isActivePath(item.path) && (
                <div className="flex items-center justify-center h-5 w-5 rounded-md bg-white/20">
                  <ChevronDown className="h-3 w-3 text-white rotate-[-90deg]" />
                </div>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Admin Section & Bottom Navigation - Professional design */}
      <div className="bg-gradient-to-t from-gray-100 dark:from-botkorp-black via-gray-50 dark:via-botkorp-black-light/60 to-transparent backdrop-blur-sm">
        {/* Admin Navigation (only visible to admins) */}
        {isAdmin && (
          <div className="px-3 pb-2 pt-3">
            <div className="border-b border-gray-200 dark:border-botkorp-slate-blue/30 pb-3">
              <div className="flex items-center gap-2 px-3 mb-2">
                <div className="h-6 w-6 rounded-lg bg-botkorp-slate-blue flex items-center justify-center shadow-md shadow-botkorp-slate-blue/30">
                  <Shield className="h-3.5 w-3.5 text-white" />
                </div>
                <p className="text-[9px] font-bold text-gray-500 dark:text-botkorp-silver/60 uppercase tracking-widest">
                  Admin Tools
                </p>
              </div>
              <div className="space-y-0.5">
                {adminNavItems.map((item) => (
                  <button
                    key={item.path}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-300 group relative overflow-hidden ${
                      isActivePath(item.path)
                        ? 'bg-botkorp-slate-blue text-white shadow-lg shadow-botkorp-slate-blue/30 scale-[1.01]'
                        : 'text-gray-700 dark:text-botkorp-silver hover:bg-gray-100 dark:hover:bg-botkorp-slate-blue/20 hover:text-gray-900 dark:hover:text-white hover:scale-[1.01]'
                    }`}
                    onClick={() => {
                      navigate(item.path);
                      if (mobile) setMobileMenuOpen(false);
                    }}
                  >
                    {/* Subtle shine effect on hover for inactive items */}
                    {!isActivePath(item.path) && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-slate-blue/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                    )}
                    
                    {/* Active indicator */}
                    {isActivePath(item.path) && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 bg-white rounded-r-full shadow-md" />
                    )}
                    
                    <span className={`relative flex-shrink-0 flex items-center justify-center h-7 w-7 rounded-lg transition-all duration-300 ${
                      isActivePath(item.path) 
                        ? 'bg-white/20 text-white scale-105' 
                        : 'bg-gray-200 dark:bg-botkorp-slate-blue/20 text-gray-700 dark:text-botkorp-silver group-hover:bg-botkorp-slate-blue/30 group-hover:text-botkorp-slate-blue dark:group-hover:text-white group-hover:scale-105'
                    }`}>
                      {React.cloneElement(item.icon, { className: 'h-4 w-4' })}
                    </span>
                    <span className={`flex-1 text-left font-semibold text-xs tracking-wide ${
                      isActivePath(item.path) ? 'text-white' : ''
                    }`}>
                      {item.label}
                    </span>
                    {isActivePath(item.path) && (
                      <div className="flex items-center justify-center h-5 w-5 rounded-md bg-white/20">
                        <ChevronDown className="h-3 w-3 text-white rotate-[-90deg]" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Bottom Navigation - Settings & Organizations */}
        <div className="p-3 border-t border-gray-200 dark:border-botkorp-slate-blue/30 space-y-2">
        {/* Settings Button */}
        {bottomNavItems.map((item) => (
          <button
            key={item.path}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-300 group relative overflow-hidden ${
              isActivePath(item.path)
                ? 'bg-botkorp-slate-blue text-white shadow-lg shadow-botkorp-slate-blue/30 scale-[1.01]'
                : 'text-gray-700 dark:text-botkorp-silver hover:bg-gray-100 dark:hover:bg-botkorp-slate-blue/20 hover:text-gray-900 dark:hover:text-white hover:scale-[1.01]'
            }`}
            onClick={() => {
              navigate(item.path);
              if (mobile) setMobileMenuOpen(false);
            }}
          >
            {/* Subtle shine effect on hover for inactive items */}
            {!isActivePath(item.path) && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-slate-blue/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            )}
            
            {isActivePath(item.path) && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 bg-white rounded-r-full shadow-md" />
            )}
            <span className={`relative flex-shrink-0 flex items-center justify-center h-7 w-7 rounded-lg transition-all duration-300 ${
              isActivePath(item.path) 
                ? 'bg-white/20 text-white scale-105' 
                : 'bg-gray-200 dark:bg-botkorp-slate-blue/20 text-gray-700 dark:text-botkorp-silver group-hover:bg-botkorp-slate-blue/30 group-hover:text-botkorp-slate-blue dark:group-hover:text-white group-hover:scale-105'
            }`}>
              {React.cloneElement(item.icon, { className: 'h-4 w-4' })}
            </span>
            <span className={`flex-1 text-left font-semibold text-xs tracking-wide ${
              isActivePath(item.path) ? 'text-white' : ''
            }`}>
              {item.label}
            </span>
          </button>
        ))}

        {/* Organization Selector - Professional design */}
        <div className="pt-2 border-t border-gray-200 dark:border-botkorp-slate-blue/30">
          <div className="flex items-center gap-2 px-3 mb-2">
            <div className="h-5 w-5 rounded-md bg-botkorp-orange flex items-center justify-center shadow-sm shadow-botkorp-orange/30">
              <Building className="h-3 w-3 text-white" />
            </div>
            <p className="text-[9px] font-bold text-gray-500 dark:text-botkorp-silver/60 uppercase tracking-widest">
              Organizations
            </p>
          </div>
          
          {/* Current Organization Display */}
          <div className="space-y-0.5 pr-1">
            {organizations.map((org) => (
              <button
                key={org.organization_id}
                className={`w-full text-left px-3 py-2 rounded-lg transition-all duration-300 group relative overflow-hidden ${
                  selectedOrg?.organization_id === org.organization_id
                    ? 'bg-botkorp-orange/20 border border-botkorp-orange/50 shadow-lg shadow-botkorp-orange/20 scale-[1.01]'
                    : 'text-gray-700 dark:text-botkorp-silver hover:bg-gray-100 dark:hover:bg-botkorp-slate-blue/20 border border-transparent hover:border-gray-300 dark:hover:border-botkorp-slate-blue/30 hover:scale-[1.01]'
                }`}
                onClick={() => {
                  handleOrgChange(org);
                  if (mobile) setMobileMenuOpen(false);
                }}
              >
                {/* Shine effect on selected */}
                {selectedOrg?.organization_id === org.organization_id && (
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-orange/10 to-transparent animate-shimmer" />
                )}
                
                <div className="flex items-center gap-2 relative">
                  <div className={`h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold shadow-sm transition-all duration-300 ${
                    selectedOrg?.organization_id === org.organization_id
                      ? 'bg-botkorp-orange text-white scale-105 ring-2 ring-botkorp-orange/30'
                      : 'bg-gray-200 dark:bg-botkorp-slate-blue/30 text-gray-700 dark:text-botkorp-silver group-hover:bg-botkorp-orange/30 group-hover:scale-105'
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
                        ? 'text-gray-600 dark:text-botkorp-silver'
                        : 'text-gray-500 dark:text-botkorp-silver/60'
                    }`}>
                      {org.member_role}
                    </p>
                  </div>
                  {selectedOrg?.organization_id === org.organization_id && (
                    <div className="flex items-center justify-center h-5 w-5">
                      <div className="h-2 w-2 rounded-full bg-botkorp-orange shadow-sm shadow-botkorp-orange/50 animate-pulse" />
                    </div>
                  )}
                </div>
              </button>
            ))}
            
            {/* Create Organization Button */}
            <button
              className="w-full text-left px-3 py-2 rounded-lg transition-all duration-300 text-gray-700 dark:text-botkorp-silver hover:bg-botkorp-orange/10 hover:text-gray-900 dark:hover:text-white border border-dashed border-gray-300 dark:border-botkorp-slate-blue/30 hover:border-botkorp-orange hover:scale-[1.01] flex items-center gap-2 group relative overflow-hidden"
              onClick={() => setShowCreateOrgDialog(true)}
            >
              <div className="h-7 w-7 rounded-lg bg-gray-200 dark:bg-botkorp-slate-blue/20 flex items-center justify-center group-hover:bg-botkorp-orange group-hover:text-white transition-all duration-300 shadow-sm group-hover:shadow-md group-hover:shadow-botkorp-orange/30 group-hover:scale-105">
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
          <div className="pt-2 border-t border-gray-200 dark:border-botkorp-slate-blue/30">
            <div className="bg-gray-100 dark:bg-botkorp-slate-blue/20 rounded-lg p-2.5 border border-botkorp-orange/30">
              <p className="text-[10px] text-gray-600 dark:text-botkorp-silver mb-1">Current Organization</p>
              <p className="font-semibold text-gray-900 dark:text-white text-xs">{selectedOrg.organization_name}</p>
              <p className="text-[10px] text-gray-500 dark:text-botkorp-silver/80 capitalize mt-0.5">{selectedOrg.member_role}</p>
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
      {/* Desktop Sidebar - Enhanced width */}
      <aside className="hidden md:block w-80 flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar - Premium Soft UI Design with Neumorphic Elements */}
        <header className="sticky top-0 z-50 backdrop-blur-3xl bg-gradient-to-br from-white/95 via-gray-50/90 to-white/95 dark:from-botkorp-black/95 dark:via-botkorp-black-light/90 dark:to-botkorp-black/95 border-b-2 border-gray-100/80 dark:border-botkorp-slate-blue/20 shadow-[0_8px_32px_rgba(0,0,0,0.04),0_2px_16px_rgba(0,0,0,0.02),0_1px_4px_rgba(0,0,0,0.01),inset_0_-1px_4px_rgba(255,255,255,0.15),inset_0_1px_2px_rgba(255,255,255,0.25)] dark:shadow-[0_12px_48px_rgba(0,0,0,0.5),0_4px_16px_rgba(255,107,53,0.08),inset_0_-1px_4px_rgba(255,107,53,0.08),inset_0_1px_2px_rgba(255,107,53,0.05)] relative overflow-hidden">
          
          {/* Background mesh pattern - subtle texture */}
          <div className="absolute inset-0 opacity-[0.015] dark:opacity-[0.02] pointer-events-none">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAyMCAwIEwgMCAwIDAgMjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iYmxhY2siIHN0cm9rZS13aWR0aD0iMC4zIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-50" />
          </div>
          
          {/* Animated floating orbs - premium ambient effect */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute w-32 h-32 -top-16 -left-16 bg-botkorp-orange/10 dark:bg-botkorp-orange/5 rounded-full blur-3xl animate-float" style={{ animationDuration: '12s', animationDelay: '0s' }} />
            <div className="absolute w-24 h-24 -top-12 right-1/4 bg-blue-500/10 dark:bg-blue-500/5 rounded-full blur-3xl animate-float" style={{ animationDuration: '15s', animationDelay: '2s' }} />
            <div className="absolute w-28 h-28 -top-14 -right-14 bg-purple-500/10 dark:bg-purple-500/5 rounded-full blur-3xl animate-float" style={{ animationDuration: '18s', animationDelay: '4s' }} />
          </div>
          
          {/* Animated gradient wave - subtle motion */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-orange/3 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none" />
          
          {/* Top accent line with glow */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-botkorp-orange/60 to-transparent shadow-[0_2px_8px_rgba(255,107,53,0.3)]" />
          
          {/* Bottom inner shadow for depth */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-300/40 dark:via-botkorp-slate-blue/30 to-transparent" />
          
          <div className="relative flex items-center justify-between px-6 py-4 gap-4">
            {/* Mobile Menu Button - Neumorphic Design */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="md:hidden">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="group relative h-12 w-12 rounded-2xl bg-gradient-to-br from-white via-gray-50 to-white dark:from-botkorp-black-light dark:via-botkorp-slate-blue/20 dark:to-botkorp-black-light border border-gray-200/60 dark:border-botkorp-slate-blue/40 shadow-[0_4px_16px_rgba(0,0,0,0.08),inset_0_1px_2px_rgba(255,255,255,0.3)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_2px_rgba(255,107,53,0.1)] hover:shadow-[0_8px_24px_rgba(255,107,53,0.15),inset_0_2px_4px_rgba(255,255,255,0.4)] dark:hover:shadow-[0_8px_24px_rgba(255,107,53,0.25),inset_0_2px_4px_rgba(255,107,53,0.15)] hover:scale-105 active:scale-95 transition-all duration-300 overflow-hidden"
                >
                  {/* Shimmer effect */}
                  <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-botkorp-orange/20 to-transparent" />
                  
                  {/* Inner glow */}
                  <div className="absolute inset-2 rounded-xl bg-gradient-to-br from-botkorp-orange/0 to-botkorp-orange/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  
                  <Menu className="relative z-10 h-5 w-5 text-gray-700 dark:text-white group-hover:text-botkorp-orange dark:group-hover:text-botkorp-orange transition-colors duration-300" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-80 border-0 bg-white dark:bg-transparent">
                <Sidebar mobile />
              </SheetContent>
            </Sheet>

            {/* Location Dropdown - Enhanced Soft UI Design */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="group relative gap-3 rounded-2xl border-gray-200/60 dark:border-botkorp-slate-blue/40 bg-gradient-to-br from-white via-gray-50/80 to-white dark:from-botkorp-black-light dark:via-botkorp-slate-blue/10 dark:to-botkorp-black-light backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.06),inset_0_1px_3px_rgba(255,255,255,0.2)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.3),inset_0_1px_3px_rgba(255,107,53,0.08)] hover:shadow-[0_8px_28px_rgba(255,107,53,0.12),inset_0_2px_4px_rgba(255,255,255,0.3)] dark:hover:shadow-[0_8px_28px_rgba(255,107,53,0.2),inset_0_2px_4px_rgba(255,107,53,0.12)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 h-12 px-4 overflow-hidden"
                >
                  {/* Animated background shimmer */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-botkorp-orange/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                  
                  {/* Location icon with enhanced styling */}
                  <span className="relative inline-flex items-center justify-center h-8 w-8 rounded-xl bg-gradient-to-br from-botkorp-orange via-orange-500 to-orange-600 text-white text-xs font-bold shadow-[0_4px_12px_rgba(255,107,53,0.35),inset_0_1px_2px_rgba(255,255,255,0.3)] group-hover:shadow-[0_6px_18px_rgba(255,107,53,0.45),inset_0_2px_4px_rgba(255,255,255,0.4)] group-hover:scale-110 transition-all duration-300 ring-2 ring-botkorp-orange/20 group-hover:ring-botkorp-orange/40" aria-hidden>
                    <div className="absolute inset-1 rounded-lg bg-gradient-to-br from-white/20 to-transparent" />
                    <span className="relative z-10">{selectedLocation?.name?.[0]?.toUpperCase() || 'L'}</span>
                  </span>
                  
                  <div className="hidden sm:flex flex-col items-start relative">
                    <span className="text-[9px] text-gray-500 dark:text-botkorp-silver/70 font-bold leading-tight uppercase tracking-[0.1em]">
                      Location
                    </span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white max-w-[140px] truncate leading-tight mt-0.5 group-hover:text-botkorp-orange dark:group-hover:text-botkorp-orange transition-colors">
                      {selectedLocation?.name || 'Select location'}
                    </span>
                  </div>
                  
                  <ChevronDown className="relative h-4 w-4 text-gray-500 dark:text-botkorp-silver group-hover:text-botkorp-orange dark:group-hover:text-botkorp-orange group-hover:rotate-180 transition-all duration-300" />
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

            {/* Search bar - Enhanced Soft UI Design */}
            <div className="hidden md:flex flex-1 mx-6">
              <div className="relative w-full max-w-xl group">
                {/* Search icon with glow effect */}
                <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-botkorp-orange/20 blur-md opacity-0 group-focus-within:opacity-100 transition-opacity duration-300" />
                    <Search className="relative h-5 w-5 text-gray-500 dark:text-botkorp-silver/70 group-focus-within:text-botkorp-orange group-focus-within:scale-110 transition-all duration-300" />
                  </div>
                </div>
                
                {/* Input field with neumorphic design */}
                <div className="relative">
                  {/* Glow effect on focus */}
                  <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-botkorp-orange/0 via-botkorp-orange/20 to-botkorp-orange/0 opacity-0 group-focus-within:opacity-100 blur-sm transition-all duration-300" />
                  
                  <Input
                    placeholder="Search services, bots, locations..."
                    className="relative h-12 pl-12 pr-4 py-3 text-sm rounded-2xl bg-gradient-to-br from-white via-gray-50/60 to-white dark:from-botkorp-black-light dark:via-botkorp-slate-blue/10 dark:to-botkorp-black-light backdrop-blur-xl border border-gray-200/60 dark:border-botkorp-slate-blue/40 shadow-[0_4px_20px_rgba(0,0,0,0.05),inset_0_1px_3px_rgba(255,255,255,0.2)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.3),inset_0_1px_3px_rgba(255,107,53,0.05)] focus:shadow-[0_8px_32px_rgba(255,107,53,0.15),inset_0_2px_4px_rgba(255,255,255,0.3)] dark:focus:shadow-[0_8px_32px_rgba(255,107,53,0.25),inset_0_2px_4px_rgba(255,107,53,0.12)] focus:border-botkorp-orange/60 focus:ring-2 focus:ring-botkorp-orange/20 transition-all duration-300 placeholder:text-gray-400 dark:placeholder:text-botkorp-silver/50 text-gray-900 dark:text-white font-medium"
                  />
                  
                  {/* Search shortcut hint */}
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-100/80 dark:bg-botkorp-slate-blue/20 border border-gray-200/60 dark:border-botkorp-slate-blue/30 shadow-sm">
                    <span className="text-[10px] font-bold text-gray-500 dark:text-botkorp-silver/60">⌘K</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Notifications & User Menu */}
            <div className="flex items-center gap-3">
              <NotificationCenter />
              
              {/* User Avatar - Enhanced Soft UI Design */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    className="group relative h-12 w-12 rounded-2xl p-0 bg-gradient-to-br from-white via-gray-50 to-white dark:from-botkorp-black-light dark:via-botkorp-slate-blue/10 dark:to-botkorp-black-light border-2 border-gray-200/60 dark:border-botkorp-slate-blue/40 shadow-[0_4px_16px_rgba(0,0,0,0.08),inset_0_1px_2px_rgba(255,255,255,0.3)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_2px_rgba(255,107,53,0.08)] hover:border-botkorp-orange/60 hover:shadow-[0_8px_24px_rgba(255,107,53,0.2),inset_0_2px_4px_rgba(255,255,255,0.4)] dark:hover:shadow-[0_8px_24px_rgba(255,107,53,0.3),inset_0_2px_4px_rgba(255,107,53,0.12)] hover:scale-105 active:scale-95 transition-all duration-300 overflow-hidden"
                  >
                    {/* Rotating gradient background on hover */}
                    <div className="absolute inset-0 bg-gradient-to-br from-botkorp-orange/0 via-botkorp-orange/10 to-orange-500/0 opacity-0 group-hover:opacity-100 group-hover:rotate-180 transition-all duration-700" />
                    
                    {/* Glow effect */}
                    <div className="absolute -inset-1 bg-gradient-to-br from-botkorp-orange/20 to-orange-500/20 rounded-2xl blur-lg opacity-0 group-hover:opacity-60 transition-opacity duration-300" />
                    
                    {/* Avatar with enhanced ring */}
                    <Avatar className="relative h-10 w-10 ring-2 ring-white/50 dark:ring-botkorp-black/50 group-hover:ring-botkorp-orange/30 transition-all duration-300">
                      <AvatarImage src={user?.user_metadata?.avatar_url} alt={user?.email} />
                      <AvatarFallback className="bg-gradient-to-br from-botkorp-orange via-orange-500 to-orange-600 text-white font-bold shadow-inner">{getUserInitials()}</AvatarFallback>
                    </Avatar>
                    
                    {/* Active status indicator */}
                    <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-gradient-to-br from-green-400 to-green-500 border-2 border-white dark:border-botkorp-black-light shadow-lg shadow-green-500/50 animate-pulse" />
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

        {/* Page Content - Clean Professional Design */}
        <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-botkorp-black">
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

