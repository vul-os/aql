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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import LocationWizard from '@/components/services/location-wizard';

export default function PortalLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [organizations, setOrganizations] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
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
    { icon: <Bot className="h-5 w-5" />, label: 'Bot Management', path: '/admin/bot-management' },
  ];

  const bottomNavItems = [
    { icon: <Settings className="h-5 w-5" />, label: 'Settings', path: '/portal/settings' },
  ];

  useEffect(() => {
    loadUserOrganizations();
  }, [user]);

  useEffect(() => {
    loadOrganizationLocations();
  }, [selectedOrg]);

  const loadUserOrganizations = async () => {
    if (!user) return;

    try {
      setLoading(true);
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Organizations fetch timeout')), 10000)
      );

      const fetchPromise = supabase.rpc('get_user_organizations', {
        user_uuid: user.id
      });

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);

      if (error) {
        console.error('RPC error:', error);
        throw error;
      }

      setOrganizations(data || []);
      
      // Check if user is admin
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_admin')
        .eq('id', user.id)
        .single();
      
      setIsAdmin(profile?.is_admin === true || profile?.role === 'admin');
      
      // Select first org or previously selected
      const savedOrgId = localStorage.getItem('selectedOrgId');
      const orgToSelect = data?.find(o => o.organization_id === savedOrgId) || data?.[0];
      
      if (orgToSelect) {
        setSelectedOrg(orgToSelect);
        localStorage.setItem('selectedOrgId', orgToSelect.organization_id);
      }
    } catch (error) {
      console.error('Error loading organizations:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to load organizations. Please refresh the page.",
        variant: "destructive"
      });
      // Set loading to false even on error to prevent indefinite loading
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  const loadOrganizationLocations = async () => {
    try {
      if (!selectedOrg?.organization_id) {
        setLocations([]);
        setSelectedLocation(null);
        return;
      }

      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', selectedOrg.organization_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setLocations(data || []);

      const savedLocationId = localStorage.getItem('selectedLocationId');
      const locToSelect = (data || []).find(l => String(l.id) === String(savedLocationId)) || data?.[0] || null;
      if (locToSelect) {
        setSelectedLocation(locToSelect);
        localStorage.setItem('selectedLocationId', locToSelect.id);
      } else {
        setSelectedLocation(null);
      }
    } catch (error) {
      console.error('Error loading locations:', error);
    }
  };

  const handleOrgChange = (org) => {
    setSelectedOrg(org);
    localStorage.setItem('selectedOrgId', org.organization_id);
    toast({
      title: "Organization switched",
      description: `Now viewing ${org.organization_name}`,
    });
  };

  const handleLocationChange = (loc) => {
    setSelectedLocation(loc);
    if (loc?.id) localStorage.setItem('selectedLocationId', loc.id);
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
      
      // Find and select the newly created org
      const newOrg = organizations.find(o => o.organization_id === data[0].organization_id);
      if (newOrg) {
        handleOrgChange(newOrg);
      }

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
    <div className={`flex flex-col h-full bg-gradient-to-b from-botkorp-grey-900 to-botkorp-grey-700 text-white relative`}>
      {/* Background overlays for subtle pattern and shine */}
      {!mobile && (
        <>
          <div className="pointer-events-none absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_20%_20%,_rgba(255,255,255,0.15),_transparent_40%)]" />
          {/* Removed top shine overlay */}
        </>
      )}

      {/* Logo - Clickable to landing */}
      <div 
        className="p-4 border-b border-white/10 flex items-center gap-3 cursor-pointer hover:bg-white/10 backdrop-blur-sm transition-colors"
        onClick={() => {
          navigate('/');
          if (mobile) setMobileMenuOpen(false);
        }}
      >
        <div className="relative">
          <div className="absolute -inset-2 rounded-full shadow-glow-green" />
          <Bot className="relative h-8 w-8 text-botkorp-green-500 drop-shadow" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">Bot Korp</h1>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 p-3 space-y-2">
        {mainNavItems.map((item) => (
          <button
            key={item.path}
            className={`w-full flex items-center justify-start gap-3 px-3 py-2 rounded-xl transition-all group ${
              isActivePath(item.path)
                ? 'bg-gradient-to-r from-botkorp-green-500 to-botkorp-green-600 text-white shadow-lg'
                : 'text-white/80 hover:bg-white/10 hover:backdrop-blur-sm'
            }`}
            onClick={() => {
              navigate(item.path);
              if (mobile) setMobileMenuOpen(false);
            }}
          >
            <span className={`inline-flex items-center justify-center h-8 w-8 rounded-lg ${
              isActivePath(item.path)
                ? 'bg-white/20'
                : 'bg-white/5 group-hover:bg-white/10'
            }`}>
              {item.icon}
            </span>
            <span className="ml-1 font-medium">{item.label}</span>
            {isActivePath(item.path) && (
              <span className="ml-auto h-6 w-1.5 rounded-full bg-white/80" />
            )}
          </button>
        ))}
      </nav>

      {/* Admin Navigation (only visible to admins) */}
      {isAdmin && (
        <div className="px-3 pb-3">
          <div className="border-t border-white/10 pt-3 mt-3">
            <div className="flex items-center gap-2 px-3 mb-2">
              <Shield className="h-4 w-4 text-white/70" />
              <p className="text-xs font-semibold text-white/70 uppercase tracking-wider">Admin</p>
            </div>
            <div className="space-y-1">
              {adminNavItems.map((item) => (
                <button
                  key={item.path}
                  className={`w-full flex items-center justify-start gap-3 px-3 py-2 rounded-xl transition-all group ${
                    isActivePath(item.path)
                      ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-lg'
                      : 'text-white/80 hover:bg-white/10 hover:backdrop-blur-sm'
                  }`}
                  onClick={() => {
                    navigate(item.path);
                    if (mobile) setMobileMenuOpen(false);
                  }}
                >
                  <span className={`inline-flex items-center justify-center h-8 w-8 rounded-lg ${
                    isActivePath(item.path)
                      ? 'bg-white/20'
                      : 'bg-white/5 group-hover:bg-white/10'
                  }`}>
                    {item.icon}
                  </span>
                  <span className="ml-1 font-medium text-sm">{item.label}</span>
                  {isActivePath(item.path) && (
                    <span className="ml-auto h-6 w-1.5 rounded-full bg-white/80" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation - Settings */}
      <div className="p-4 border-t border-white/10 mt-auto">
        {bottomNavItems.map((item) => (
          <button
            key={item.path}
            className={`w-full flex items-center justify-start gap-3 px-3 py-2 rounded-xl transition-all ${
              isActivePath(item.path)
                ? 'bg-gradient-to-r from-botkorp-green-500 to-botkorp-green-600 text-white shadow-lg'
                : 'text-white/80 hover:bg-white/10 hover:backdrop-blur-sm'
            }`}
            onClick={() => {
              navigate(item.path);
              if (mobile) setMobileMenuOpen(false);
            }}
          >
            <span className={`inline-flex items-center justify-center h-8 w-8 rounded-lg ${
              isActivePath(item.path)
                ? 'bg-white/20'
                : 'bg-white/5'
            }`}>
              {item.icon}
            </span>
            <span className="ml-1 font-medium">{item.label}</span>
          </button>
        ))}

        {/* Organizations at bottom */}
        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-sm text-white/70 mb-2">Organizations</p>
          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {organizations.map((org) => (
              <button
                key={org.organization_id}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                  selectedOrg?.organization_id === org.organization_id
                    ? 'bg-white/15 text-white'
                    : 'text-white/80 hover:bg-white/10'
                }`}
                onClick={() => {
                  handleOrgChange(org);
                  if (mobile) setMobileMenuOpen(false);
                }}
              >
                {org.organization_name}
              </button>
            ))}
            {/* Create Organization Button */}
            <button
              className="w-full text-left px-3 py-2 rounded-lg transition-colors text-white/80 hover:bg-white/10 border border-white/20 border-dashed flex items-center gap-2"
              onClick={() => setShowCreateOrgDialog(true)}
            >
              <Plus className="h-4 w-4" />
              Create Organization
            </button>
          </div>
        </div>

        {/* Organization Info (mobile only) */}
        {mobile && selectedOrg && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-sm text-white/70 mb-2">Organization</p>
            <p className="font-semibold">{selectedOrg.organization_name}</p>
            <p className="text-xs text-white/60 capitalize">{selectedOrg.member_role}</p>
          </div>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!selectedOrg) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center space-y-4">
          <Building2 className="h-16 w-16 text-muted-foreground mx-auto" />
          <h2 className="text-2xl font-bold">No Organization</h2>
          <p className="text-muted-foreground">
            You don't belong to any organization yet. Please contact support.
          </p>
          <Button onClick={handleSignOut}>Sign Out</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:block w-64 flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <header className="relative border-b bg-gradient-to-r from-botkorp-green-50 to-white dark:from-botkorp-grey-900 dark:to-botkorp-grey-700/80 backdrop-blur supports-[backdrop-filter]:bg-transparent shadow-md">
          <div className="flex items-center justify-between p-4 gap-3">
            {/* Mobile Menu Button */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="md:hidden">
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-64">
                <Sidebar mobile />
              </SheetContent>
            </Sheet>

            {/* Location Dropdown (replaces Organization selector) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2 rounded-xl bg-white/70 dark:bg-white/5 backdrop-blur border-white/60 hover:bg-white/90 dark:hover:bg-white/10 shadow-sm"
                >
                  <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-botkorp-green-500 to-accent-blue text-white text-[11px] font-semibold shadow" aria-hidden>
                    {selectedLocation?.name?.[0]?.toUpperCase() || 'L'}
                  </span>
                  <MapPin className="h-4 w-4 text-botkorp-grey-700 dark:text-white/80" />
                  <span className="hidden sm:inline max-w-[180px] truncate">
                    {selectedLocation?.name || 'Select location'}
                  </span>
                  <ChevronDown className="h-4 w-4" />
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

            {/* Search bar */}
            <div className="hidden md:flex flex-1 mx-2">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  className="pl-9 rounded-xl bg-white/70 dark:bg-white/5 backdrop-blur border"
                />
              </div>
            </div>

            {/* User Menu */}
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                    <Avatar className="h-10 w-10">
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

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-muted/10">
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
              setSelectedLocation(newLocation);
              if (newLocation?.id) {
                localStorage.setItem('selectedLocationId', newLocation.id);
              }
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

