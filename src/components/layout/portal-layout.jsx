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
  Building2,
  CreditCard,
  Moon,
  Sun,
  Bell,
  Search
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/components/theme-provider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

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

  const mainNavItems = [
    { icon: <LayoutDashboard className="h-5 w-5" />, label: 'Dashboard', path: '/portal' },
    { icon: <Sprout className="h-5 w-5" />, label: 'Services', path: '/portal/services' },
    { icon: <Users className="h-5 w-5" />, label: 'Members', path: '/portal/members' },
    { icon: <CreditCard className="h-5 w-5" />, label: 'Billing', path: '/portal/billing' },
  ];

  const bottomNavItems = [
    { icon: <Settings className="h-5 w-5" />, label: 'Settings', path: '/portal/settings' },
  ];

  useEffect(() => {
    loadUserOrganizations();
  }, [user]);

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

  const handleOrgChange = (org) => {
    setSelectedOrg(org);
    localStorage.setItem('selectedOrgId', org.organization_id);
    toast({
      title: "Organization switched",
      description: `Now viewing ${org.organization_name}`,
    });
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
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-white/10" />
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
        <header className="border-b bg-background/80 supports-[backdrop-filter]:bg-background/60 backdrop-blur shadow-sm">
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

            {/* Organization Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Building2 className="h-4 w-4" />
                  <span className="hidden sm:inline max-w-[150px] md:max-w-[200px] truncate">
                    {selectedOrg.organization_name}
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Organizations</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {organizations.map((org) => (
                  <DropdownMenuItem
                    key={org.organization_id}
                    onClick={() => handleOrgChange(org)}
                    className="cursor-pointer"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{org.organization_name}</span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {org.member_role}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
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
              {/* Notifications */}
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                <span className="absolute -top-0.5 -right-0.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                  </span>
                </span>
              </Button>

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
    </div>
  );
}

