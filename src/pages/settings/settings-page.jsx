import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/auth-context';
import { useSearchParams, useOutletContext } from 'react-router-dom';
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
  Building
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/components/theme-provider';
import PageHeader from '@/components/ui/page-header';
import LocationWizard from '@/components/services/location-wizard';

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [searchParams] = useSearchParams();
  const { selectedOrg } = useOutletContext();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState({
    full_name: '',
    phone: ''
  });
  const [locations, setLocations] = useState([]);
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
  const [notifications, setNotifications] = useState({
    email_alerts: true,
    push_notifications: true,
    bot_offline: true,
    maintenance_reminders: true,
    service_complete: true,
    low_battery: true
  });

  useEffect(() => {
    loadUserProfile();
    loadLegalProfile();
    loadNotificationPreferences();
  }, [user]);
  
  useEffect(() => {
    if (selectedOrg?.organization_name) {
      setOrganizationName(selectedOrg.organization_name);
    }
  }, [selectedOrg]);

  useEffect(() => {
    if (selectedOrg?.organization_id) {
      loadLocations();
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
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('first_name, surname, id_number, physical_address, physical_city, physical_province, physical_postal_code, cell_phone, legal_profile_completed, updated_at')
        .eq('id', user.id)
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
      }
    } catch (error) {
      console.error('Error loading legal profile:', error);
    }
  };

  const loadNotificationPreferences = () => {
    // Load from localStorage for now
    const saved = localStorage.getItem('notificationPreferences');
    if (saved) {
      setNotifications(JSON.parse(saved));
    }
  };

  const loadLocations = async () => {
    if (!selectedOrg?.organization_id) return;

    try {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', selectedOrg.organization_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLocations(data || []);
    } catch (error) {
      console.error('Error loading locations:', error);
      toast({
        title: "Error",
        description: "Failed to load locations",
        variant: "destructive"
      });
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
      
      loadLocations();
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

  const handleNotificationUpdate = () => {
    localStorage.setItem('notificationPreferences', JSON.stringify(notifications));
    toast({
      title: "Success",
      description: "Notification preferences saved",
    });
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

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Manage your account settings and preferences"
        icon={<Settings className="h-6 w-6 text-primary" />}
      />

      {/* Settings Tabs */}
      <Tabs defaultValue={searchParams.get('tab') || 'profile'} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5 lg:w-auto">
          <TabsTrigger value="profile">
            <User className="h-4 w-4 mr-2" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="organization">
            <Building className="h-4 w-4 mr-2" />
            Organization
          </TabsTrigger>
          <TabsTrigger value="legal">
            <Shield className="h-4 w-4 mr-2" />
            Legal Profile
          </TabsTrigger>
          <TabsTrigger value="locations">
            <MapPin className="h-4 w-4 mr-2" />
            Locations
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="h-4 w-4 mr-2" />
            Notifications
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>
                Update your personal information and contact details
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleProfileUpdate} className="space-y-6">
                {/* Avatar Section (Read-only) */}
                <div className="flex items-center gap-4">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src={profile.avatar_url} alt={profile.full_name} />
                    <AvatarFallback className="text-lg">{getUserInitials()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-medium">{profile.full_name || user?.email}</p>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                  </div>
                </div>

                <Separator />

                {/* Full Name */}
                <div className="space-y-2">
                  <Label htmlFor="full_name">Full Name</Label>
                  <Input
                    id="full_name"
                    type="text"
                    value={profile.full_name}
                    onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                    placeholder="John Doe"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={profile.phone}
                    onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    placeholder="+27 123 456 789"
                  />
                </div>

                <Button type="submit" disabled={loading}>
                  <Save className="h-4 w-4 mr-2" />
                  {loading ? 'Saving...' : 'Save Changes'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Organization Tab */}
        <TabsContent value="organization" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5" />
                Organization Settings
              </CardTitle>
              <CardDescription>
                Manage your organization details and settings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleOrganizationUpdate} className="space-y-6">
                {/* Current Organization Info */}
                <div className="bg-muted/50 border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Current Organization</p>
                      <p className="font-semibold text-lg">{selectedOrg?.organization_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Your Role</p>
                      <p className="font-medium capitalize">{selectedOrg?.member_role || 'Member'}</p>
                    </div>
                  </div>
                  {selectedOrg?.organization_slug && (
                    <p className="text-xs text-muted-foreground">
                      Organization ID: {selectedOrg.organization_slug}
                    </p>
                  )}
                </div>

                <Separator />

                {/* Organization Name Update */}
                {(selectedOrg?.member_role === 'owner' || selectedOrg?.member_role === 'admin') ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="organization_name">Organization Name</Label>
                      <Input
                        id="organization_name"
                        type="text"
                        value={organizationName}
                        onChange={(e) => setOrganizationName(e.target.value)}
                        placeholder="My Organization"
                        disabled={updatingOrg}
                      />
                      <p className="text-xs text-muted-foreground">
                        This is the name that will appear across the platform for your organization.
                      </p>
                    </div>

                    <Button type="submit" disabled={updatingOrg || organizationName === selectedOrg?.organization_name}>
                      <Save className="h-4 w-4 mr-2" />
                      {updatingOrg ? 'Updating...' : 'Update Organization'}
                    </Button>
                  </>
                ) : (
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                    <div className="flex gap-3">
                      <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-2 text-sm">
                        <p className="font-semibold text-amber-900 dark:text-amber-100">
                          Limited Permissions
                        </p>
                        <p className="text-amber-800 dark:text-amber-200">
                          Only organization owners and admins can update organization settings. 
                          Please contact your organization owner if you need to make changes.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <Separator />

                {/* Additional Organization Info */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Organization Details
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground">Subscription Tier</Label>
                      <div className="p-3 bg-muted/50 rounded-md border">
                        <p className="font-medium capitalize">{selectedOrg?.subscription_tier || 'Free'}</p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground">Status</Label>
                      <div className="p-3 bg-muted/50 rounded-md border">
                        <p className="font-medium flex items-center gap-2">
                          {selectedOrg?.is_active !== false ? (
                            <>
                              <CheckCircle className="h-4 w-4 text-green-600" />
                              Active
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-4 w-4 text-red-600" />
                              Inactive
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Legal Profile Tab */}
        <TabsContent value="legal" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Legal Profile Information
                  </CardTitle>
                  <CardDescription>
                    Your legal information for service contracts (read-only)
                  </CardDescription>
                </div>
                {legalProfile.legal_profile_completed ? (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="h-5 w-5" />
                    <span className="text-sm font-medium">Verified</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-amber-600">
                    <AlertCircle className="h-5 w-5" />
                    <span className="text-sm font-medium">Incomplete</span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {legalProfile.legal_profile_completed ? (
                <>
                  {/* Personal Information */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      Personal Information
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground">Legal First Name</Label>
                        <div className="p-3 bg-muted/50 rounded-md border">
                          <p className="font-medium">{legalProfile.first_name || 'Not set'}</p>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground">Legal Surname</Label>
                        <div className="p-3 bg-muted/50 rounded-md border">
                          <p className="font-medium">{legalProfile.surname || 'Not set'}</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground">ID Number</Label>
                      <div className="p-3 bg-muted/50 rounded-md border">
                        <p className="font-mono font-medium">{legalProfile.id_number || 'Not set'}</p>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Contact Information */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      Contact Information
                    </h3>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground">Cell Phone</Label>
                      <div className="p-3 bg-muted/50 rounded-md border">
                        <p className="font-medium">{legalProfile.cell_phone || 'Not set'}</p>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Physical Address */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      Physical Address
                    </h3>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground">Street Address</Label>
                      <div className="p-3 bg-muted/50 rounded-md border">
                        <p className="font-medium">{legalProfile.physical_address || 'Not set'}</p>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground">City</Label>
                        <div className="p-3 bg-muted/50 rounded-md border">
                          <p className="font-medium">{legalProfile.physical_city || 'Not set'}</p>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground">Province</Label>
                        <div className="p-3 bg-muted/50 rounded-md border">
                          <p className="font-medium">{legalProfile.physical_province || 'Not set'}</p>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground">Postal Code</Label>
                        <div className="p-3 bg-muted/50 rounded-md border">
                          <p className="font-medium">{legalProfile.physical_postal_code || 'Not set'}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Information Notice */}
                  <div className="bg-accent/5 dark:bg-accent/10 border border-accent/20 dark:border-accent/30 rounded-lg p-4">
                    <div className="flex gap-3">
                      <FileText className="h-5 w-5 text-accent shrink-0 mt-0.5" />
                      <div className="space-y-2 text-sm">
                        <p className="font-semibold text-foreground">
                          Why is this information read-only?
                        </p>
                        <p className="text-foreground/80">
                          Your legal profile information is used for official service contracts and rental agreements. 
                          Once verified, it cannot be changed for legal and compliance reasons.
                        </p>
                        <p className="text-foreground/80">
                          If you need to update this information, please contact support at{' '}
                          <a href="mailto:support@botkorp.co.za" className="underline font-medium">
                            support@botkorp.co.za
                          </a>
                        </p>
                        {legalProfile.updated_at && (
                          <p className="text-xs text-muted-foreground pt-2 border-t border-border">
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
                <div className="text-center py-12">
                  <Shield className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-semibold mb-2">Legal Profile Not Completed</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    You haven't completed your legal profile yet. This will be collected when you create your first service.
                  </p>
                  <Button onClick={() => window.location.href = '/portal/services/add'}>
                    Create Your First Service
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Locations Tab */}
        <TabsContent value="locations" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Manage Locations
                  </CardTitle>
                  <CardDescription>
                    View and manage your property locations
                  </CardDescription>
                </div>
                <Button onClick={() => setShowAddLocationDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Location
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {locations.length > 0 ? (
                <div className="space-y-4">
                  {locations.map((location) => (
                    <div
                      key={location.id}
                      className="flex items-start justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <MapPin className="h-5 w-5 text-primary" />
                        </div>
                        <div className="space-y-1">
                          <h4 className="font-semibold">{location.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            {location.address}
                            {location.city && `, ${location.city}`}
                            {location.province && `, ${location.province}`}
                          </p>
                          {location.postal_code && (
                            <p className="text-xs text-muted-foreground">
                              Postal Code: {location.postal_code}
                            </p>
                          )}
                          {location.area_size && (
                            <p className="text-xs text-muted-foreground">
                              Area: {location.area_size} m²
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteLocation(location.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <MapPin className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-semibold mb-2">No Locations Yet</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    You haven't added any locations yet. Add your first location to get started.
                  </p>
                  <Button onClick={() => setShowAddLocationDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Your First Location
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>
                Control how and when you receive notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Email Notifications */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Email Alerts</Label>
                  <p className="text-sm text-muted-foreground">
                    Receive email notifications for important events
                  </p>
                </div>
                <Switch
                  checked={notifications.email_alerts}
                  onCheckedChange={(checked) =>
                    setNotifications({ ...notifications, email_alerts: checked })
                  }
                />
              </div>

              <Separator />

              {/* Push Notifications */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Push Notifications</Label>
                  <p className="text-sm text-muted-foreground">
                    Receive browser push notifications
                  </p>
                </div>
                <Switch
                  checked={notifications.push_notifications}
                  onCheckedChange={(checked) =>
                    setNotifications({ ...notifications, push_notifications: checked })
                  }
                />
              </div>

              <Separator />

              {/* Specific Alerts */}
              <div className="space-y-4">
                <Label className="text-base">Alert Types</Label>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Bot Offline</Label>
                      <p className="text-sm text-muted-foreground">
                        Alert when a bot goes offline
                      </p>
                    </div>
                    <Switch
                      checked={notifications.bot_offline}
                      onCheckedChange={(checked) =>
                        setNotifications({ ...notifications, bot_offline: checked })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Maintenance Reminders</Label>
                      <p className="text-sm text-muted-foreground">
                        Remind about upcoming maintenance
                      </p>
                    </div>
                    <Switch
                      checked={notifications.maintenance_reminders}
                      onCheckedChange={(checked) =>
                        setNotifications({ ...notifications, maintenance_reminders: checked })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Service Complete</Label>
                      <p className="text-sm text-muted-foreground">
                        Notify when service is complete
                      </p>
                    </div>
                    <Switch
                      checked={notifications.service_complete}
                      onCheckedChange={(checked) =>
                        setNotifications({ ...notifications, service_complete: checked })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Low Battery</Label>
                      <p className="text-sm text-muted-foreground">
                        Alert when bot battery is low
                      </p>
                    </div>
                    <Switch
                      checked={notifications.low_battery}
                      onCheckedChange={(checked) =>
                        setNotifications({ ...notifications, low_battery: checked })
                      }
                    />
                  </div>
                </div>
              </div>

              <Button onClick={handleNotificationUpdate}>
                <Save className="h-4 w-4 mr-2" />
                Save Preferences
              </Button>
            </CardContent>
          </Card>
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
              loadLocations();
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

