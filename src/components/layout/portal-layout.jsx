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
    { icon: <MapPin className="h-5 w-5" />, label: 'Locations', path: '/portal/locations' },
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
    <div className={`flex flex-col h-full bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white border-r border-gray-800/50 relative shadow-2xl overflow-hidden`}>
      {/* Subtle mesh gradient overlay */}
      <div 
        className="pointer-events-none absolute inset-0 opacity-[0.03]" 
        style={{ 
          backgroundImage: `
            radial-gradient(circle at 20% 50%, rgba(255,126,95,0.3) 0%, transparent 50%),
            radial-gradient(circle at 80% 80%, rgba(59,130,246,0.2) 0%, transparent 50%),
            radial-gradient(circle at 1px 1px, rgba(255,255,255,0.1) 1px, transparent 0)
          `,
          backgroundSize: '100% 100%, 100% 100%, 32px 32px' 
        }} 
      />

      {/* Logo Section - Professional header */}
      <div 
        className="relative p-6 border-b border-white/10 flex items-center gap-3 cursor-pointer group overflow-hidden bg-gradient-to-r from-transparent via-gray-900/30 to-transparent"
        onClick={() => {
          navigate('/');
          if (mobile) setMobileMenuOpen(false);
        }}
      >
        {/* Hover shimmer effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
        
        <div className="relative flex items-center justify-center h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange via-red-500 to-red-600 shadow-xl shadow-botkorp-orange/40 ring-2 ring-white/10 group-hover:scale-105 group-hover:shadow-botkorp-orange/60 group-hover:ring-white/20 transition-all duration-300">
          <Bot className="h-6 w-6 text-white" />
        </div>
        <div className="relative flex-1">
          <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-lg">
            Bot Korp
          </h1>
          <p className="text-[10px] text-white/50 uppercase tracking-widest font-semibold">
            Control Center
          </p>
        </div>
      </div>

      {/* Main Navigation - Professional design with better hierarchy */}
      <nav className="flex-1 px-3 py-5 space-y-1.5 overflow-y-auto custom-scrollbar">
        <div className="px-3 mb-3">
          <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
            Main Menu
          </p>
        </div>
        <div className="space-y-1">
          {mainNavItems.map((item) => (
            <button
              key={item.path}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all duration-300 group relative overflow-hidden ${
                isActivePath(item.path)
                  ? 'bg-gradient-to-r from-botkorp-orange via-red-500 to-red-600 text-white shadow-xl shadow-botkorp-orange/25 scale-[1.02]'
                  : 'text-white/70 hover:bg-white/[0.08] hover:text-white hover:scale-[1.01]'
              }`}
              onClick={() => {
                navigate(item.path);
                if (mobile) setMobileMenuOpen(false);
              }}
            >
              {/* Subtle shine effect on hover for inactive items */}
              {!isActivePath(item.path) && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
              )}
              
              {/* Active indicator bar - sleeker design */}
              {isActivePath(item.path) && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-10 w-1.5 bg-white rounded-r-full shadow-lg shadow-white/50" />
              )}
              
              {/* Icon container with backdrop */}
              <span className={`relative flex-shrink-0 flex items-center justify-center h-9 w-9 rounded-lg transition-all duration-300 ${
                isActivePath(item.path) 
                  ? 'bg-white/20 text-white scale-110 shadow-lg' 
                  : 'bg-white/[0.03] text-white/60 group-hover:bg-botkorp-orange/20 group-hover:text-botkorp-orange group-hover:scale-110'
              }`}>
                {item.icon}
              </span>
              
              {/* Label with better typography */}
              <span className={`flex-1 text-left font-semibold text-sm tracking-wide ${
                isActivePath(item.path) ? 'text-white drop-shadow-sm' : ''
              }`}>
                {item.label}
              </span>

              {/* Refined chevron indicator */}
              {isActivePath(item.path) && (
                <div className="flex items-center justify-center h-6 w-6 rounded-md bg-white/20">
                  <ChevronDown className="h-3.5 w-3.5 text-white rotate-[-90deg]" />
                </div>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Admin Section & Bottom Navigation - Professional design */}
      <div className="mt-auto bg-gradient-to-t from-gray-950/95 via-gray-900/60 to-transparent backdrop-blur-sm">
        {/* Admin Navigation (only visible to admins) */}
        {isAdmin && (
          <div className="px-3 pb-3 pt-4">
            <div className="border-b border-white/10 pb-4">
              <div className="flex items-center gap-2.5 px-3 mb-3">
                <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/30 ring-2 ring-purple-400/20">
                  <Shield className="h-4 w-4 text-white" />
                </div>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                  Admin Tools
                </p>
              </div>
              <div className="space-y-1">
                {adminNavItems.map((item) => (
                  <button
                    key={item.path}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all duration-300 group relative overflow-hidden ${
                      isActivePath(item.path)
                        ? 'bg-gradient-to-r from-purple-500 via-purple-600 to-purple-700 text-white shadow-xl shadow-purple-500/25 scale-[1.02]'
                        : 'text-white/70 hover:bg-white/[0.08] hover:text-white hover:scale-[1.01]'
                    }`}
                    onClick={() => {
                      navigate(item.path);
                      if (mobile) setMobileMenuOpen(false);
                    }}
                  >
                    {/* Subtle shine effect on hover for inactive items */}
                    {!isActivePath(item.path) && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                    )}
                    
                    {/* Active indicator */}
                    {isActivePath(item.path) && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1.5 bg-white rounded-r-full shadow-lg shadow-white/50" />
                    )}
                    
                    <span className={`relative flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-lg transition-all duration-300 ${
                      isActivePath(item.path) 
                        ? 'bg-white/20 text-white scale-110 shadow-lg' 
                        : 'bg-white/[0.03] text-white/60 group-hover:bg-purple-500/20 group-hover:text-purple-400 group-hover:scale-110'
                    }`}>
                      {item.icon}
                    </span>
                    <span className={`flex-1 text-left font-semibold text-sm tracking-wide ${
                      isActivePath(item.path) ? 'text-white drop-shadow-sm' : ''
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
        <div className="p-3 border-t border-white/10 space-y-3">
        {/* Settings Button */}
        {bottomNavItems.map((item) => (
          <button
            key={item.path}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all duration-300 group relative overflow-hidden ${
              isActivePath(item.path)
                ? 'bg-gradient-to-r from-gray-700 via-gray-600 to-gray-700 text-white shadow-xl shadow-gray-900/50 scale-[1.02]'
                : 'text-white/70 hover:bg-white/[0.08] hover:text-white hover:scale-[1.01]'
            }`}
            onClick={() => {
              navigate(item.path);
              if (mobile) setMobileMenuOpen(false);
            }}
          >
            {/* Subtle shine effect on hover for inactive items */}
            {!isActivePath(item.path) && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            )}
            
            {isActivePath(item.path) && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1.5 bg-white rounded-r-full shadow-lg shadow-white/50" />
            )}
            <span className={`relative flex-shrink-0 flex items-center justify-center h-9 w-9 rounded-lg transition-all duration-300 ${
              isActivePath(item.path) 
                ? 'bg-white/20 text-white scale-110 shadow-lg' 
                : 'bg-white/[0.03] text-white/60 group-hover:bg-gray-400/20 group-hover:text-white group-hover:scale-110'
            }`}>
              {item.icon}
            </span>
            <span className={`flex-1 text-left font-semibold text-sm tracking-wide ${
              isActivePath(item.path) ? 'text-white drop-shadow-sm' : ''
            }`}>
              {item.label}
            </span>
          </button>
        ))}

        {/* Organization Selector - Professional design */}
        <div className="pt-3 border-t border-white/10">
          <div className="flex items-center gap-2.5 px-3 mb-3">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-md shadow-blue-500/20 ring-2 ring-blue-400/20">
              <Building className="h-3.5 w-3.5 text-white" />
            </div>
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
              Organizations
            </p>
          </div>
          
          {/* Current Organization Display */}
          <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
            {organizations.map((org) => (
              <button
                key={org.organization_id}
                className={`w-full text-left px-3 py-3 rounded-xl transition-all duration-300 group relative overflow-hidden ${
                  selectedOrg?.organization_id === org.organization_id
                    ? 'bg-gradient-to-r from-blue-500/50 via-blue-600/50 to-blue-500/50 border border-blue-400/70 shadow-xl shadow-blue-500/30 scale-[1.02]'
                    : 'text-white/70 hover:bg-white/[0.08] border border-transparent hover:border-white/10 hover:scale-[1.01]'
                }`}
                onClick={() => {
                  handleOrgChange(org);
                  if (mobile) setMobileMenuOpen(false);
                }}
              >
                {/* Shine effect on selected */}
                {selectedOrg?.organization_id === org.organization_id && (
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
                )}
                
                <div className="flex items-center gap-2.5 relative">
                  <div className={`h-9 w-9 rounded-lg flex items-center justify-center text-sm font-bold shadow-lg transition-all duration-300 ${
                    selectedOrg?.organization_id === org.organization_id
                      ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white scale-110 ring-2 ring-white/30'
                      : 'bg-white/[0.08] text-white/70 group-hover:bg-blue-500/20 group-hover:scale-105'
                  }`}>
                    {org.organization_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate tracking-wide ${
                      selectedOrg?.organization_id === org.organization_id
                        ? 'text-white drop-shadow-sm'
                        : 'text-white/90 group-hover:text-white'
                    }`}>
                      {org.organization_name}
                    </p>
                    <p className="text-[10px] text-white/40 capitalize tracking-wider font-medium">
                      {org.member_role}
                    </p>
                  </div>
                  {selectedOrg?.organization_id === org.organization_id && (
                    <div className="flex items-center justify-center h-6 w-6">
                      <div className="h-2.5 w-2.5 rounded-full bg-white shadow-lg shadow-white/50 animate-pulse" />
                    </div>
                  )}
                </div>
              </button>
            ))}
            
            {/* Create Organization Button */}
            <button
              className="w-full text-left px-3 py-3 rounded-xl transition-all duration-300 text-white/70 hover:bg-white/[0.08] hover:text-white border-2 border-dashed border-white/20 hover:border-botkorp-orange hover:scale-[1.01] flex items-center gap-2.5 group relative overflow-hidden"
              onClick={() => setShowCreateOrgDialog(true)}
            >
              <div className="h-9 w-9 rounded-lg bg-white/[0.08] flex items-center justify-center group-hover:bg-gradient-to-br group-hover:from-botkorp-orange group-hover:to-red-500 group-hover:text-white transition-all duration-300 shadow-md group-hover:shadow-lg group-hover:shadow-botkorp-orange/30 group-hover:scale-110">
                <Plus className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold group-hover:text-botkorp-orange transition-colors tracking-wide">
                Create Organization
              </span>
            </button>
          </div>
        </div>

        {/* Organization Info (mobile only) */}
        {mobile && selectedOrg && (
          <div className="pt-3 border-t border-white/10">
            <div className="bg-white/5 rounded-lg p-3 border border-white/10">
              <p className="text-xs text-white/50 mb-1">Current Organization</p>
              <p className="font-semibold text-white">{selectedOrg.organization_name}</p>
              <p className="text-xs text-white/60 capitalize mt-0.5">{selectedOrg.member_role}</p>
            </div>
          </div>
        )}
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
        {/* Toolbar - White Background */}
        <header className="relative" style={{ backgroundColor: '#F9FAFB' }}>
          <div className="flex items-center justify-between px-4 py-2.5 gap-2">
            {/* Mobile Menu Button */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="md:hidden">
                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-gray-100 dark:hover:bg-gray-800">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-80">
                <Sidebar mobile />
              </SheetContent>
            </Sheet>

            {/* Location Dropdown - Transparent */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2 rounded-md border-white/20 dark:border-white/10 bg-transparent hover:bg-white/10 dark:hover:bg-white/5 shadow-none transition-all duration-200 h-9 px-2.5"
                >
                  <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-gradient-to-br from-botkorp-orange via-red-500 to-red-600 text-white text-xs font-bold shadow-sm" aria-hidden>
                    {selectedLocation?.name?.[0]?.toUpperCase() || 'L'}
                  </span>
                  <div className="hidden sm:flex flex-col items-start">
                    <span className="text-[10px] text-gray-600 dark:text-gray-300 font-medium leading-tight">
                      Location
                    </span>
                    <span className="text-xs font-semibold text-gray-900 dark:text-white max-w-[120px] truncate leading-tight">
                      {selectedLocation?.name || 'Select location'}
                    </span>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 text-gray-600 dark:text-gray-300" />
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

            {/* Search bar - Transparent */}
            <div className="hidden md:flex flex-1 mx-3">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
                <Input
                  placeholder="Search services, bots, locations..."
                  className="h-9 pl-8 pr-3 py-1.5 text-sm rounded-md bg-transparent border-white/20 dark:border-white/10 focus:bg-white/10 dark:focus:bg-white/5 focus:ring-2 focus:ring-botkorp-orange/20 transition-all placeholder:text-gray-500 dark:placeholder:text-gray-400"
                />
              </div>
            </div>

            {/* Notifications & User Menu */}
            <div className="flex items-center gap-1.5">
              <NotificationCenter />
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full p-0">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.user_metadata?.avatar_url} alt={user?.email} />
                      <AvatarFallback>{getUserInitials()}</AvatarFallback>
                    </Avatar>
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

        {/* Page Content - Enhanced */}
        <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
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

