import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/auth-context';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Settings,
  User,
  Bell,
  Palette,
  Moon,
  Sun,
  Monitor,
  Save,
  Shield,
  FileText,
  CheckCircle,
  AlertCircle,
  MapPin,
  Trash2,
  Plus,
  Building,
  Mail,
  Smartphone
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/components/theme-provider';
import PageHeader from '@/components/ui/page-header';
import LocationWizard from '@/components/services/location-wizard';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import PushSubscriptionDevices from '@/components/notifications/push-subscription-devices';

export default function SettingsPage() {
  const { user, selectedOrg, selectedLocation, locations: contextLocations, loadOrganizationLocations } = useAuth();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { tab } = useParams();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState({
    full_name: '',
    phone: ''
  });
  // Use locations from context instead of local state
  const locations = contextLocations || [];
  const [showAddLocationDialog, setShowAddLocationDialog] = useState(false);
  
  // Organization settings
  const [organizationName, setOrganizationName] = useState('');
  const [updatingOrg, setUpdatingOrg] = useState(false);

  // Legal profile data (read-only)
  const [legalProfile, setLegalProfile] = useState({
    first_name: '',
    surname: '',
    id_number: '',
    physical_address: '',
    physical_city: '',
    physical_province: '',
    physical_postal_code: '',
    cell_phone: '',
    legal_profile_completed: false,
    updated_at: null
  });

  // Notification preferences
  const [notificationPreferences, setNotificationPreferences] = useState(null);
  const [loadingNotifications, setLoadingNotifications] = useState(true);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const { permission, requestPermission, isSupported, isSubscribed, unsubscribe } = usePushNotifications();

  useEffect(() => {
    loadUserProfile();
    loadNotificationPreferences();
  }, [user]);

  useEffect(() => {
    if (selectedOrg?.organization_id) {
      loadLegalProfile();
    }
  }, [selectedOrg]);
  
  useEffect(() => {
    if (selectedOrg?.organization_name) {
      setOrganizationName(selectedOrg.organization_name);
    }
  }, [selectedOrg]);

  const loadUserProfile = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setProfile({
          full_name: data.full_name || '',
          phone: data.phone || ''
        });
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  };

  const loadLegalProfile = async () => {
    if (!selectedOrg?.organization_id) return;

    try {
      const { data, error } = await supabase
        .from('organization_legal_profiles')
        .select('first_name, surname, id_number, physical_address, physical_city, physical_province, physical_postal_code, cell_phone, legal_profile_completed, updated_at')
        .eq('organization_id', selectedOrg.organization_id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setLegalProfile({
          first_name: data.first_name || '',
          surname: data.surname || '',
          id_number: data.id_number || '',
          physical_address: data.physical_address || '',
          physical_city: data.physical_city || '',
          physical_province: data.physical_province || '',
          physical_postal_code: data.physical_postal_code || '',
          cell_phone: data.cell_phone || '',
          legal_profile_completed: data.legal_profile_completed || false,
          updated_at: data.updated_at
        });
      } else {
        // No legal profile yet, set empty state
        setLegalProfile({
          first_name: '',
          surname: '',
          id_number: '',
          physical_address: '',
          physical_city: '',
          physical_province: '',
          physical_postal_code: '',
          cell_phone: '',
          legal_profile_completed: false,
          updated_at: null
        });
      }
    } catch (error) {
      console.error('Error loading legal profile:', error);
    }
  };

  // Locations are now managed in AuthContext
  // Use loadOrganizationLocations from context to refresh when needed

  const loadNotificationPreferences = async () => {
    if (!user?.id) {
      setLoadingNotifications(false);
      return;
    }

    try {
      // First try to get existing preferences
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle(); // Use maybeSingle() instead of single() to avoid errors when no record exists

      if (error) throw error;

      if (data) {
        setNotificationPreferences(data);
      } else {
        // Create default preferences using upsert to handle race conditions
        const { data: newPrefs, error: createError } = await supabase
          .from('notification_preferences')
          .upsert(
            { user_id: user.id },
            { onConflict: 'user_id', ignoreDuplicates: false }
          )
          .select()
          .single();

        if (createError) {
          // If upsert failed, try to fetch again (in case another process created it)
          const { data: retryData, error: retryError } = await supabase
            .from('notification_preferences')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();
          
          if (retryError) throw retryError;
          if (retryData) {
            setNotificationPreferences(retryData);
          } else {
            throw createError;
          }
        } else {
          setNotificationPreferences(newPrefs);
        }
      }
    } catch (error) {
      console.error('Error loading notification preferences:', error);
      toast({
        title: 'Error',
        description: `Failed to load notification preferences: ${error.message || 'Unknown error'}`,
        variant: 'destructive'
      });
    } finally {
      setLoadingNotifications(false);
    }
  };

  const saveNotificationPreferences = async () => {
    setSavingNotifications(true);
    try {
      const { error } = await supabase
        .from('notification_preferences')
        .update(notificationPreferences)
        .eq('id', notificationPreferences.id);

      if (error) throw error;

      toast({
        title: 'Saved',
        description: 'Notification preferences updated successfully'
      });
    } catch (error) {
      console.error('Error saving notification preferences:', error);
      toast({
        title: 'Error',
        description: 'Failed to save preferences',
        variant: 'destructive'
      });
    } finally {
      setSavingNotifications(false);
    }
  };

  const handleNotificationChange = (field, value) => {
    setNotificationPreferences(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handlePushToggle = async (enabled) => {
    if (enabled) {
      const success = await requestPermission();
      if (success) {
        handleNotificationChange('push_enabled', true);
      }
    } else {
      await unsubscribe();
      handleNotificationChange('push_enabled', false);
    }
  };

  const handleDeleteLocation = async (locationId) => {
    if (!confirm('Are you sure you want to delete this location? This action cannot be undone.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('locations')
        .update({ is_active: false })
        .eq('id', locationId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Location deleted successfully",
      });
      
      loadOrganizationLocations();
    } catch (error) {
      console.error('Error deleting location:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete location",
        variant: "destructive"
      });
    }
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: profile.full_name,
          phone: profile.phone
        })
        .eq('id', user.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Profile updated successfully",
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOrganizationUpdate = async (e) => {
    e.preventDefault();
    
    if (!organizationName.trim()) {
      toast({
        title: "Validation Error",
        description: "Organization name cannot be empty",
        variant: "destructive"
      });
      return;
    }
    
    if (!selectedOrg?.organization_id) {
      toast({
        title: "Error",
        description: "No organization selected",
        variant: "destructive"
      });
      return;
    }
    
    setUpdatingOrg(true);
    try {
      const { data, error } = await supabase.rpc('update_organization', {
        p_user_id: user.id,
        p_organization_id: selectedOrg.organization_id,
        p_organization_name: organizationName.trim()
      });
      
      if (error) throw error;
      
      toast({
        title: "Success",
        description: "Organization name updated successfully",
      });
      
      // Trigger a reload of the layout to refresh organization name
      window.location.reload();
    } catch (error) {
      console.error('Error updating organization:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update organization",
        variant: "destructive"
      });
    } finally {
      setUpdatingOrg(false);
    }
  };

  const getUserInitials = () => {
    if (profile.full_name) {
      return profile.full_name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return user?.email?.[0]?.toUpperCase() || 'U';
  };

  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return <Sun className="h-4 w-4" />;
      case 'dark':
        return <Moon className="h-4 w-4" />;
      default:
        return <Monitor className="h-4 w-4" />;
    }
  };

  // Get current tab from URL or default to 'profile'
  const currentTab = tab || 'profile';

  // Handle tab change - update URL without page refresh
  const handleTabChange = (newTab) => {
    navigate(`/portal/settings/${newTab}`, { replace: false });
  };

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto min-h-screen">
      {/* Header Section - Soft UI Background */}
      <div className="bg-gradient-to-br from-background via-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-top-3 duration-500">
        <PageHeader
          title="Settings"
          subtitle="Manage your account settings and preferences"
          icon={<Settings className="h-5 w-5 text-botkorp-orange" />}
        />
      </div>

      {/* Settings Tabs */}
      <Tabs value={currentTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 bg-transparent h-auto p-0">
            <TabsTrigger 
              value="profile" 
              className="data-[state=active]:bg-botkorp-orange data-[state=active]:text-white data-[state=active]:shadow-[0_4px_20px_rgb(255,107,53,0.25)] h-10 rounded-xl transition-all bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)]"
            >
              <User className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Profile</span>
            </TabsTrigger>
            <TabsTrigger 
              value="organization"
              className="data-[state=active]:bg-botkorp-orange data-[state=active]:text-white data-[state=active]:shadow-[0_4px_20px_rgb(255,107,53,0.25)] h-10 rounded-xl transition-all bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)]"
            >
              <Building className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Organization</span>
            </TabsTrigger>
            <TabsTrigger 
              value="legal"
              className="data-[state=active]:bg-botkorp-orange data-[state=active]:text-white data-[state=active]:shadow-[0_4px_20px_rgb(255,107,53,0.25)] h-10 rounded-xl transition-all bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)]"
            >
              <Shield className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Legal</span>
            </TabsTrigger>
            <TabsTrigger 
              value="locations"
              className="data-[state=active]:bg-botkorp-orange data-[state=active]:text-white data-[state=active]:shadow-[0_4px_20px_rgb(255,107,53,0.25)] h-10 rounded-xl transition-all bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)]"
            >
              <MapPin className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Locations</span>
            </TabsTrigger>
            <TabsTrigger 
              value="notifications"
              className="data-[state=active]:bg-botkorp-orange data-[state=active]:text-white data-[state=active]:shadow-[0_4px_20px_rgb(255,107,53,0.25)] h-10 rounded-xl transition-all bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)]"
            >
              <Bell className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Notifications</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                <User className="h-6 w-6 text-botkorp-orange" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Profile Information</h3>
                <p className="text-sm text-muted-foreground/70">Update your personal information and contact details</p>
              </div>
            </div>

            <form onSubmit={handleProfileUpdate} className="space-y-6">
              {/* Avatar Section */}
              <div className="flex items-center gap-6 p-6 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                <Avatar className="h-24 w-24 ring-4 ring-botkorp-orange/10">
                  <AvatarImage src={profile.avatar_url} alt={profile.full_name} />
                  <AvatarFallback className="text-xl font-bold bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 text-botkorp-orange">
                    {getUserInitials()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="text-lg font-bold mb-1">{profile.full_name || user?.email}</p>
                  <p className="text-sm text-muted-foreground/70 flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5" />
                    {user?.email}
                  </p>
                </div>
              </div>

              <Separator className="bg-border/50" />

              {/* Full Name */}
              <div className="space-y-2">
                <Label htmlFor="full_name" className="text-sm font-semibold">Full Name</Label>
                <Input
                  id="full_name"
                  type="text"
                  value={profile.full_name}
                  onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                  placeholder="John Doe"
                  className="h-11 bg-background/60 backdrop-blur-sm border-none shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] focus:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06),0_0_0_3px_rgb(255,107,53,0.1)] transition-all rounded-xl"
                />
              </div>

              {/* Phone */}
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm font-semibold">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                  placeholder="+27 123 456 789"
                  className="h-11 bg-background/60 backdrop-blur-sm border-none shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] focus:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06),0_0_0_3px_rgb(255,107,53,0.1)] transition-all rounded-xl"
                />
              </div>

              <Button 
                type="submit" 
                disabled={loading}
                className="h-11 px-6 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all"
              >
                <Save className="h-4 w-4 mr-2" />
                {loading ? 'Saving...' : 'Save Changes'}
              </Button>
            </form>
          </div>
        </TabsContent>

        {/* Organization Tab */}
        <TabsContent value="organization" className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(59,130,246,0.15)]">
                <Building className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Organization Settings</h3>
                <p className="text-sm text-muted-foreground/70">Manage your organization details and settings</p>
              </div>
            </div>

            <form onSubmit={handleOrganizationUpdate} className="space-y-6">
              {/* Current Organization Info */}
              <div className="grid gap-4 md:grid-cols-2 p-5 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                <div>
                  <p className="text-xs text-muted-foreground/70 uppercase tracking-wider font-semibold mb-2">Current Organization</p>
                  <p className="font-bold text-xl">{selectedOrg?.organization_name}</p>
                  {selectedOrg?.organization_slug && (
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      ID: {selectedOrg.organization_slug}
                    </p>
                  )}
                </div>
                <div className="text-left md:text-right">
                  <p className="text-xs text-muted-foreground/70 uppercase tracking-wider font-semibold mb-2">Your Role</p>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 shadow-[0_2px_10px_rgb(255,107,53,0.1)]">
                    <Shield className="h-4 w-4 text-botkorp-orange" />
                    <span className="font-bold capitalize text-botkorp-orange">{selectedOrg?.member_role || 'Member'}</span>
                  </div>
                </div>
              </div>

              <Separator className="bg-border/50" />

              {/* Organization Name Update */}
              {(selectedOrg?.member_role === 'owner' || selectedOrg?.member_role === 'admin') ? (
                <>
                  <div className="space-y-3">
                    <Label htmlFor="organization_name" className="text-sm font-semibold">Organization Name</Label>
                    <Input
                      id="organization_name"
                      type="text"
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      placeholder="My Organization"
                      disabled={updatingOrg}
                      className="h-11 bg-background/60 backdrop-blur-sm border-none shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] focus:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06),0_0_0_3px_rgb(255,107,53,0.1)] transition-all rounded-xl"
                    />
                    <p className="text-xs text-muted-foreground/60 leading-relaxed">
                      This is the name that will appear across the platform for your organization.
                    </p>
                  </div>

                  <Button 
                    type="submit" 
                    disabled={updatingOrg || organizationName === selectedOrg?.organization_name}
                    className="h-11 px-6 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {updatingOrg ? 'Updating...' : 'Update Organization'}
                  </Button>
                </>
              ) : (
                <div className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border border-amber-500/20 rounded-2xl p-5 shadow-[0_4px_20px_rgb(245,158,11,0.1)]">
                  <div className="flex gap-3">
                    <div className="h-10 w-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                      <AlertCircle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="space-y-2 text-sm flex-1">
                      <p className="font-bold text-amber-900 dark:text-amber-100">
                        Limited Permissions
                      </p>
                      <p className="text-amber-800 dark:text-amber-200 leading-relaxed">
                        Only organization owners and admins can update organization settings. 
                        Please contact your organization owner if you need to make changes.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <Separator className="bg-border/50" />

              {/* Additional Organization Info */}
              <div className="space-y-4">
                <h3 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                  Organization Details
                </h3>
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground/70">Status</Label>
                  <div className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <p className="font-bold flex items-center gap-2">
                      {selectedOrg?.is_active !== false ? (
                        <>
                          <div className="h-8 w-8 rounded-lg bg-green-500/15 flex items-center justify-center">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          </div>
                          <span>Active</span>
                        </>
                      ) : (
                        <>
                          <div className="h-8 w-8 rounded-lg bg-red-500/15 flex items-center justify-center">
                            <AlertCircle className="h-4 w-4 text-red-600" />
                          </div>
                          <span>Inactive</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </TabsContent>

        {/* Legal Profile Tab */}
        <TabsContent value="legal" className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex items-center gap-3 flex-1">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-green-500/15 to-green-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(34,197,94,0.15)]">
                  <Shield className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Legal Profile Information</h3>
                  <p className="text-sm text-muted-foreground/70">Your legal information for service contracts (read-only)</p>
                </div>
              </div>
              {legalProfile.legal_profile_completed ? (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-br from-green-500/15 to-green-500/5 shadow-[0_2px_10px_rgb(34,197,94,0.15)]">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-bold text-green-600">Verified</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-br from-amber-500/15 to-amber-500/5 shadow-[0_2px_10px_rgb(245,158,11,0.15)]">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-bold text-amber-600">Incomplete</span>
                </div>
              )}
            </div>

            <div className="space-y-6">
              {legalProfile.legal_profile_completed ? (
                <>
                  {/* Personal Information */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                      Personal Information
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground/70">Legal First Name</Label>
                        <div className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                          <p className="font-bold">{legalProfile.first_name || 'Not set'}</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground/70">Legal Surname</Label>
                        <div className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                          <p className="font-bold">{legalProfile.surname || 'Not set'}</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm text-muted-foreground/70">ID Number</Label>
                      <div className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                        <p className="font-mono font-bold text-lg">{legalProfile.id_number || 'Not set'}</p>
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-border/50" />

                  {/* Contact Information */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                      Contact Information
                    </h3>
                    <div className="space-y-2">
                      <Label className="text-sm text-muted-foreground/70">Cell Phone</Label>
                      <div className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                        <p className="font-bold flex items-center gap-2">
                          <Smartphone className="h-4 w-4 text-muted-foreground/70" />
                          {legalProfile.cell_phone || 'Not set'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-border/50" />

                  {/* Physical Address */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                      Physical Address
                    </h3>
                    <div className="space-y-2">
                      <Label className="text-sm text-muted-foreground/70">Street Address</Label>
                      <div className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                        <p className="font-bold flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground/70" />
                          {legalProfile.physical_address || 'Not set'}
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground/70">City</Label>
                        <div className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                          <p className="font-bold">{legalProfile.physical_city || 'Not set'}</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground/70">Province</Label>
                        <div className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                          <p className="font-bold">{legalProfile.physical_province || 'Not set'}</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground/70">Postal Code</Label>
                        <div className="p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                          <p className="font-mono font-bold">{legalProfile.physical_postal_code || 'Not set'}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-border/50" />

                  {/* Information Notice */}
                  <div className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/20 rounded-2xl p-5 shadow-[0_4px_20px_rgb(59,130,246,0.1)]">
                    <div className="flex gap-3">
                      <div className="h-10 w-10 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                        <FileText className="h-5 w-5 text-blue-600" />
                      </div>
                      <div className="space-y-3 text-sm flex-1">
                        <p className="font-bold text-foreground">
                          Why is this information read-only?
                        </p>
                        <p className="text-foreground/80 leading-relaxed">
                          Your legal profile information is used for official service contracts and rental agreements. 
                          Once verified, it cannot be changed for legal and compliance reasons.
                        </p>
                        <p className="text-foreground/80 leading-relaxed">
                          If you need to update this information, please contact support at{' '}
                          <a href="mailto:support@botkorp.co.za" className="underline font-bold text-botkorp-orange hover:text-botkorp-orange/80 transition-colors">
                            support@botkorp.co.za
                          </a>
                        </p>
                        {legalProfile.updated_at && (
                          <p className="text-xs text-muted-foreground/60 pt-3 border-t border-border/50">
                            Last updated: {new Date(legalProfile.updated_at).toLocaleDateString('en-ZA', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-16">
                  <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-green-500/15 to-green-500/5 mb-6 animate-in zoom-in-50 duration-500 shadow-[0_8px_30px_rgb(34,197,94,0.15)]">
                    <Shield className="h-10 w-10 text-green-600 animate-pulse" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">Legal Profile Not Completed</h3>
                  <p className="text-muted-foreground/70 mb-8 max-w-md mx-auto leading-relaxed">
                    You haven't completed your legal profile yet. This will be collected when you create your first service.
                  </p>
                  <Button 
                    onClick={() => window.location.href = '/portal/services/add'}
                    className="h-11 px-6 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create Your First Service
                  </Button>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Locations Tab */}
        <TabsContent value="locations" className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-purple-500/15 to-purple-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(168,85,247,0.15)]">
                  <MapPin className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Manage Locations</h3>
                  <p className="text-sm text-muted-foreground/70">View and manage your property locations</p>
                </div>
              </div>
              <Button 
                onClick={() => setShowAddLocationDialog(true)}
                className="h-10 px-5 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Location
              </Button>
            </div>

            {locations.length > 0 ? (
              <div className="space-y-4">
                {locations.map((location, index) => (
                  <div
                    key={location.id}
                    className="flex items-start justify-between p-5 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgb(0,0,0,0.08)] transition-all group animate-in fade-in slide-in-from-bottom-3"
                    style={{ animationDelay: `${index * 50}ms`, animationDuration: '500ms' }}
                  >
                    <div className="flex items-start gap-4 flex-1">
                      <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-500/15 to-purple-500/5 flex items-center justify-center flex-shrink-0 shadow-[0_2px_10px_rgb(168,85,247,0.1)] group-hover:shadow-[0_4px_20px_rgb(168,85,247,0.2)] transition-all">
                        <MapPin className="h-5 w-5 text-purple-600" />
                      </div>
                      <div className="space-y-2 flex-1 min-w-0">
                        <h4 className="font-bold text-base">{location.name}</h4>
                        <p className="text-sm text-muted-foreground/70 leading-relaxed">
                          {location.address}
                          {location.city && `, ${location.city}`}
                          {location.province && `, ${location.province}`}
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {location.postal_code && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-background/80 text-xs font-medium shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                              Postal: {location.postal_code}
                            </span>
                          )}
                          {location.area_size && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-background/80 text-xs font-medium shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                              Area: {location.area_size} m²
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteLocation(location.id)}
                      className="h-9 w-9 rounded-xl text-red-600 hover:text-red-700 hover:bg-red-500/10 transition-all flex-shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-purple-500/15 to-purple-500/5 mb-6 animate-in zoom-in-50 duration-500 shadow-[0_8px_30px_rgb(168,85,247,0.15)]">
                  <MapPin className="h-10 w-10 text-purple-600 animate-pulse" />
                </div>
                <h3 className="text-xl font-bold mb-3">No Locations Yet</h3>
                <p className="text-muted-foreground/70 mb-8 max-w-md mx-auto leading-relaxed">
                  You haven't added any locations yet. Add your first location to get started.
                </p>
                <Button 
                  onClick={() => setShowAddLocationDialog(true)}
                  className="h-11 px-6 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Location
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {loadingNotifications ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-botkorp-orange/20 border-t-botkorp-orange"></div>
            </div>
          ) : (
            <>
              {/* Global Settings */}
              <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-yellow-500/15 to-yellow-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(234,179,8,0.15)]">
                    <Bell className="h-6 w-6 text-yellow-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Notification Channels</h3>
                    <p className="text-sm text-muted-foreground/70">Choose how you want to receive notifications</p>
                  </div>
                </div>

                <div className="space-y-5">
                  {/* Email Notifications */}
                  <div className="flex items-center justify-between p-5 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center shadow-[0_2px_10px_rgb(59,130,246,0.1)]">
                        <Mail className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <Label htmlFor="email_enabled" className="text-base font-bold cursor-pointer">Email Notifications</Label>
                        <p className="text-sm text-muted-foreground/70">
                          Receive notifications via email
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="email_enabled"
                      checked={notificationPreferences?.email_enabled || false}
                      onCheckedChange={(checked) => handleNotificationChange('email_enabled', checked)}
                    />
                  </div>

                  {/* Push Notifications */}
                  <div className="flex items-center justify-between p-5 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500/15 to-purple-500/5 flex items-center justify-center shadow-[0_2px_10px_rgb(168,85,247,0.1)]">
                        <Smartphone className="h-5 w-5 text-purple-600" />
                      </div>
                      <div>
                        <Label htmlFor="push_enabled" className="text-base font-bold cursor-pointer">Push Notifications</Label>
                        <p className="text-sm text-muted-foreground/70">
                          Receive browser push notifications
                          {!isSupported && ' (Not supported in your browser)'}
                          {isSubscribed && ' ✓ Subscribed'}
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="push_enabled"
                      checked={notificationPreferences?.push_enabled && isSubscribed || false}
                      onCheckedChange={handlePushToggle}
                      disabled={!isSupported}
                    />
                  </div>
                </div>
              </div>

              {/* Email Preferences */}
              <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(59,130,246,0.15)]">
                    <Mail className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Email Preferences</h3>
                    <p className="text-sm text-muted-foreground/70">Choose which types of notifications you want to receive via email</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <div>
                      <Label htmlFor="email_bot_alerts" className="text-sm font-bold cursor-pointer">Bot Alerts</Label>
                      <p className="text-sm text-muted-foreground/70">
                        Low battery, offline, errors, maintenance
                      </p>
                    </div>
                    <Switch
                      id="email_bot_alerts"
                      checked={notificationPreferences?.email_bot_alerts || false}
                      onCheckedChange={(checked) => handleNotificationChange('email_bot_alerts', checked)}
                      disabled={!notificationPreferences?.email_enabled}
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <div>
                      <Label htmlFor="email_service_reminders" className="text-sm font-bold cursor-pointer">Service Reminders</Label>
                      <p className="text-sm text-muted-foreground/70">
                        Upcoming services, appointments, completions
                      </p>
                    </div>
                    <Switch
                      id="email_service_reminders"
                      checked={notificationPreferences?.email_service_reminders || false}
                      onCheckedChange={(checked) => handleNotificationChange('email_service_reminders', checked)}
                      disabled={!notificationPreferences?.email_enabled}
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <div>
                      <Label htmlFor="email_billing" className="text-sm font-bold cursor-pointer">Billing & Payments</Label>
                      <p className="text-sm text-muted-foreground/70">
                        Invoices, payment confirmations, failures
                      </p>
                    </div>
                    <Switch
                      id="email_billing"
                      checked={notificationPreferences?.email_billing || false}
                      onCheckedChange={(checked) => handleNotificationChange('email_billing', checked)}
                      disabled={!notificationPreferences?.email_enabled}
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <div>
                      <Label htmlFor="email_organization" className="text-sm font-bold cursor-pointer">Organization Updates</Label>
                      <p className="text-sm text-muted-foreground/70">
                        New members, role changes, team updates
                      </p>
                    </div>
                    <Switch
                      id="email_organization"
                      checked={notificationPreferences?.email_organization || false}
                      onCheckedChange={(checked) => handleNotificationChange('email_organization', checked)}
                      disabled={!notificationPreferences?.email_enabled}
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <div>
                      <Label htmlFor="email_system" className="text-sm font-bold cursor-pointer">System Notifications</Label>
                      <p className="text-sm text-muted-foreground/70">
                        Important system updates and announcements
                      </p>
                    </div>
                    <Switch
                      id="email_system"
                      checked={notificationPreferences?.email_system || false}
                      onCheckedChange={(checked) => handleNotificationChange('email_system', checked)}
                      disabled={!notificationPreferences?.email_enabled}
                    />
                  </div>
                </div>
              </div>

              {/* Push Preferences */}
              <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-purple-500/15 to-purple-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(168,85,247,0.15)]">
                    <Smartphone className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Push Notification Preferences</h3>
                    <p className="text-sm text-muted-foreground/70">Choose which types of notifications you want to receive as push notifications</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <div>
                      <Label htmlFor="push_bot_alerts" className="text-sm font-bold cursor-pointer">Bot Alerts</Label>
                      <p className="text-sm text-muted-foreground/70">
                        Low battery, offline, errors, maintenance
                      </p>
                    </div>
                    <Switch
                      id="push_bot_alerts"
                      checked={notificationPreferences?.push_bot_alerts || false}
                      onCheckedChange={(checked) => handleNotificationChange('push_bot_alerts', checked)}
                      disabled={!notificationPreferences?.push_enabled || !isSubscribed}
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <div>
                      <Label htmlFor="push_service_reminders" className="text-sm font-bold cursor-pointer">Service Reminders</Label>
                      <p className="text-sm text-muted-foreground/70">
                        Upcoming services, appointments, completions
                      </p>
                    </div>
                    <Switch
                      id="push_service_reminders"
                      checked={notificationPreferences?.push_service_reminders || false}
                      onCheckedChange={(checked) => handleNotificationChange('push_service_reminders', checked)}
                      disabled={!notificationPreferences?.push_enabled || !isSubscribed}
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <div>
                      <Label htmlFor="push_billing" className="text-sm font-bold cursor-pointer">Billing & Payments</Label>
                      <p className="text-sm text-muted-foreground/70">
                        Payment failures and urgent billing issues
                      </p>
                    </div>
                    <Switch
                      id="push_billing"
                      checked={notificationPreferences?.push_billing || false}
                      onCheckedChange={(checked) => handleNotificationChange('push_billing', checked)}
                      disabled={!notificationPreferences?.push_enabled || !isSubscribed}
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <div>
                      <Label htmlFor="push_organization" className="text-sm font-bold cursor-pointer">Organization Updates</Label>
                      <p className="text-sm text-muted-foreground/70">
                        Important team and organization changes
                      </p>
                    </div>
                    <Switch
                      id="push_organization"
                      checked={notificationPreferences?.push_organization || false}
                      onCheckedChange={(checked) => handleNotificationChange('push_organization', checked)}
                      disabled={!notificationPreferences?.push_enabled || !isSubscribed}
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                    <div>
                      <Label htmlFor="push_system" className="text-sm font-bold cursor-pointer">System Notifications</Label>
                      <p className="text-sm text-muted-foreground/70">
                        Critical system alerts and announcements
                      </p>
                    </div>
                    <Switch
                      id="push_system"
                      checked={notificationPreferences?.push_system || false}
                      onCheckedChange={(checked) => handleNotificationChange('push_system', checked)}
                      disabled={!notificationPreferences?.push_enabled || !isSubscribed}
                    />
                  </div>
                </div>
              </div>

              {/* Push Subscription Devices */}
              {isSubscribed && (
                <PushSubscriptionDevices userId={user?.id} />
              )}

              {/* Save Button */}
              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={loadNotificationPreferences}
                  disabled={savingNotifications}
                  className="h-11 px-6 font-medium border-none bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-muted transition-all rounded-xl"
                >
                  Reset
                </Button>
                <Button
                  onClick={saveNotificationPreferences}
                  disabled={savingNotifications}
                  className="h-11 px-6 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {savingNotifications ? 'Saving...' : 'Save Preferences'}
                </Button>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

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
            }}
            onCancel={() => setShowAddLocationDialog(false)}
            embedded={true}
            showCancel={true}
            title=""
            description=""
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

