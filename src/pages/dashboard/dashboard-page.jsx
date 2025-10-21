import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Bot,
  Sprout,
  Droplets,
  AlertTriangle,
  Calendar,
  Home,
  Activity,
  TrendingUp,
  MapPin,
  CheckCircle,
  Info,
  Sparkles,
  Plus,
  ArrowRight,
  Mail,
  UserPlus,
  X,
  Check,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import LocationWizard from '@/components/services/location-wizard';
import LegalProfileWizard from '@/components/services/legal-profile-wizard';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { format } from 'date-fns';
import PageHeader from '@/components/ui/page-header';
import MyLocationsBotStatus from '@/components/services/my-locations-bot-status';

export default function DashboardPage() {
  const { user, selectedOrg, selectedLocation } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState(null);
  const [botStatusData, setBotStatusData] = useState([]);
  const [botTypeData, setBotTypeData] = useState([]);
  const [mowingActivity, setMowingActivity] = useState([]);
  const [upcomingServices, setUpcomingServices] = useState([]);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [showLocationWizard, setShowLocationWizard] = useState(false);
  const [showLegalWizard, setShowLegalWizard] = useState(false);
  const [createdLocation, setCreatedLocation] = useState(null);
  const [profile, setProfile] = useState(null);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [loadingInvitations, setLoadingInvitations] = useState(true);

  const COLORS = ['#FF6B35', '#4F5D75', '#B0B3B8', '#121212', '#F59E0B', '#EF4444'];
  
  // Custom Tooltip Components
  const CustomPieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
          <p className="font-semibold text-gray-900 dark:text-gray-100">{payload[0].name}</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {payload[0].value} bot{payload[0].value !== 1 ? 's' : ''} ({(payload[0].percent * 100).toFixed(1)}%)
          </p>
        </div>
      );
    }
    return null;
  };

  const CustomBarTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
          <p className="font-semibold text-gray-900 dark:text-gray-100 capitalize">{label.replace('_', ' ')}</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {payload[0].value} bot{payload[0].value !== 1 ? 's' : ''}
          </p>
        </div>
      );
    }
    return null;
  };

  const CustomLineTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
          <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {format(new Date(label), 'MMM d, yyyy')}
          </p>
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-gray-600 dark:text-gray-300">{entry.name}:</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">{entry.value}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  // Get user's first name
  const getUserName = () => {
    const fullName = user?.user_metadata?.full_name;
    if (fullName) {
      return fullName.split(' ')[0];
    }
    return 'there';
  };

  // Generate insights based on analytics data
  const insights = useMemo(() => {
    if (!analytics) return [];

    const messages = [];

    // Check if they have no bots yet
    if (analytics.total_bots === 0) {
      messages.push({
        type: 'info',
        icon: <Info className="h-5 w-5" />,
        message: "You haven't added any bots yet. Get started by adding your first bot to automate your property maintenance!"
      });
      return messages;
    }

    // All bots operational - great news!
    if (analytics.operational_bots === analytics.total_bots && analytics.total_bots > 0) {
      messages.push({
        type: 'success',
        icon: <CheckCircle className="h-5 w-5" />,
        message: `Excellent! All ${analytics.total_bots} of your bots are operational and ready to work.`
      });
    }

    // Some bots offline
    if (analytics.offline_bots > 0) {
      messages.push({
        type: 'warning',
        icon: <AlertTriangle className="h-5 w-5" />,
        message: `${analytics.offline_bots} bot${analytics.offline_bots > 1 ? 's are' : ' is'} currently offline. Check their connection status.`
      });
    }

    // Bots with errors
    if (analytics.error_bots > 0) {
      messages.push({
        type: 'error',
        icon: <AlertTriangle className="h-5 w-5" />,
        message: `${analytics.error_bots} bot${analytics.error_bots > 1 ? 's need' : ' needs'} attention due to errors.`
      });
    }

    // Critical alerts
    if (analytics.critical_alerts_count > 0) {
      messages.push({
        type: 'error',
        icon: <AlertTriangle className="h-5 w-5" />,
        message: `You have ${analytics.critical_alerts_count} critical alert${analytics.critical_alerts_count > 1 ? 's' : ''} that require immediate attention.`
      });
    }

    // Upcoming services
    if (analytics.upcoming_services_count > 0 && analytics.next_service_date) {
      const daysUntil = Math.ceil((new Date(analytics.next_service_date) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntil <= 7) {
        messages.push({
          type: 'info',
          icon: <Calendar className="h-5 w-5" />,
          message: `Your next service is coming up ${daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`} on ${format(new Date(analytics.next_service_date), 'MMM d')}.`
        });
      }
    }

    // Gardens needing maintenance
    if (analytics.gardens_needing_maintenance > 0) {
      messages.push({
        type: 'warning',
        icon: <Sprout className="h-5 w-5" />,
        message: `${analytics.gardens_needing_maintenance} garden${analytics.gardens_needing_maintenance > 1 ? 's require' : ' requires'} maintenance.`
      });
    }

    // Pools needing maintenance
    if (analytics.pools_needing_maintenance > 0) {
      messages.push({
        type: 'warning',
        icon: <Droplets className="h-5 w-5" />,
        message: `${analytics.pools_needing_maintenance} pool${analytics.pools_needing_maintenance > 1 ? 's need' : ' needs'} maintenance.`
      });
    }

    // Everything is good
    if (messages.length === 0 && analytics.total_bots > 0) {
      messages.push({
        type: 'success',
        icon: <Sparkles className="h-5 w-5" />,
        message: "Everything looks great! All systems are running smoothly."
      });
    }

    return messages;
  }, [analytics]);

  // Load pending invitations for current user
  const loadPendingInvitations = async () => {
    if (!user?.email) return;
    
    try {
      setLoadingInvitations(true);
      const { data, error } = await supabase
        .from('organization_invitations')
        .select(`
          *,
          organization:organizations!organization_id(name),
          inviter:profiles!invited_by(first_name, full_name, email)
        `)
        .eq('email', user.email)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPendingInvitations(data || []);
    } catch (error) {
      console.error('Error loading invitations:', error);
    } finally {
      setLoadingInvitations(false);
    }
  };

  const handleAcceptInvitation = async (invitationId) => {
    try {
      const { data, error } = await supabase.rpc('accept_member_invitation', {
        p_invitation_id: invitationId,
        p_user_id: user.id
      });

      if (error) throw error;

      toast({
        variant: 'success',
        title: 'Invitation Accepted! 🎉',
        description: 'You have been added to the organization.',
      });

      // Reload invitations and redirect
      loadPendingInvitations();
      window.location.reload(); // Reload to update org list
    } catch (error) {
      console.error('Error accepting invitation:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to accept invitation',
        variant: 'destructive'
      });
    }
  };

  const handleDeclineInvitation = async (invitationId) => {
    try {
      const { error } = await supabase.rpc('decline_member_invitation', {
        p_invitation_id: invitationId,
        p_user_id: user.id
      });

      if (error) throw error;

      toast({
        title: 'Invitation Declined',
        description: 'The invitation has been declined.',
      });

      loadPendingInvitations();
    } catch (error) {
      console.error('Error declining invitation:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to decline invitation',
        variant: 'destructive'
      });
    }
  };

  // Emergency stop all bots
  const handleEmergencyStopAll = async () => {
    if (!window.confirm('⚠️ Are you sure you want to stop ALL bots? This will immediately halt all bot operations.')) {
      return;
    }

    try {
      // Get all bots for the organization
      const { data: bots, error: fetchError } = await supabase
        .from('bots')
        .select('id')
        .eq('organization_id', selectedOrg.id)
        .neq('status', 'offline');

      if (fetchError) throw fetchError;

      if (!bots || bots.length === 0) {
        toast({
          title: 'No Active Bots',
          description: 'All bots are already offline.',
        });
        return;
      }

      // Send emergency_stop command to all active bots
      const commands = bots.map(bot => ({
        bot_id: bot.id,
        command_type: 'emergency_stop',
        command_data: { 
          timestamp: new Date().toISOString(),
          triggered_by: 'dashboard_emergency_stop'
        },
        created_by: user.id
      }));

      const { error: commandError } = await supabase
        .from('bot_commands')
        .insert(commands);

      if (commandError) throw commandError;

      toast({
        title: '🛑 Emergency Stop Activated',
        description: `Emergency stop sent to ${bots.length} bot(s).`,
        variant: 'destructive'
      });

      // Reload analytics to update UI
      setTimeout(() => {
        loadAnalytics();
      }, 1000);

    } catch (error) {
      console.error('Error sending emergency stop:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to send emergency stop command',
        variant: 'destructive'
      });
    }
  };

  useEffect(() => {
    if (selectedOrg) {
      loadDashboardData();
    }
    // Load invitations regardless of selectedOrg (user-specific)
    if (user) {
      loadPendingInvitations();
    }
  }, [selectedOrg, user]);

  const loadDashboardData = async () => {
    if (!selectedOrg?.organization_id) return;

    try {
      setLoading(true);

      // Load user profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (profileData) {
        setProfile(profileData);
      }

      // Load organization legal profile
      const { data: orgLegalProfile } = await supabase
        .from('organization_legal_profiles')
        .select('*')
        .eq('organization_id', selectedOrg.organization_id)
        .single();

      // Check for locations first
      const { data: locationsData } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', selectedOrg.organization_id)
        .eq('is_active', true);

      setLocations(locationsData || []);

      // Auto-show legal wizard if:
      // 1. User has locations (just created one)
      // 2. Organization legal profile is not complete
      // 3. Not already showing location wizard
      if (locationsData && locationsData.length > 0 && 
          (!orgLegalProfile || !orgLegalProfile.legal_profile_completed) && 
          !showLocationWizard && !showLegalWizard) {
        // Set the first location as createdLocation for wizard
        setCreatedLocation(locationsData[0]);
        setShowLegalWizard(true);
      }

      // If no locations, stop here - we'll show the welcome screen
      if (!locationsData || locationsData.length === 0) {
        setLoading(false);
        return;
      }

      // Load all data in parallel for faster loading
      // Use Promise.allSettled to continue even if some functions don't exist yet
      const results = await Promise.allSettled([
        supabase.rpc('get_organization_dashboard_analytics', { org_id: selectedOrg.organization_id }),
        supabase.rpc('get_bot_status_distribution', { org_id: selectedOrg.organization_id }),
        supabase.rpc('get_bot_type_distribution', { org_id: selectedOrg.organization_id }),
        supabase.rpc('get_mowing_activity_last_30_days', { org_id: selectedOrg.organization_id }),
        supabase.rpc('get_upcoming_services', { org_id: selectedOrg.organization_id, days_ahead: 30 }),
        supabase.rpc('get_recent_alerts', { org_id: selectedOrg.organization_id, limit_count: 5 })
      ]);

      // Safely extract results
      const [analyticsResult, statusResult, typeResult, mowingResult, servicesResult, alertsResult] = results.map(r => 
        r.status === 'fulfilled' ? r.value : { error: r.reason, data: null }
      );

      // Check for errors and set data (don't throw, just log warnings)
      if (analyticsResult.error) {
        console.warn('Analytics error:', analyticsResult.error);
        setAnalytics({});
      } else {
        setAnalytics(analyticsResult.data?.[0] || {});
      }

      if (statusResult.error) console.warn('Status data error:', statusResult.error);
      setBotStatusData(statusResult.data || []);

      if (typeResult.error) console.warn('Type data error:', typeResult.error);
      setBotTypeData(typeResult.data || []);

      if (mowingResult.error) console.warn('Mowing data error:', mowingResult.error);
      setMowingActivity((mowingResult.data || []).reverse());

      if (servicesResult.error) console.warn('Services data error:', servicesResult.error);
      setUpcomingServices(servicesResult.data || []);

      if (alertsResult.error) console.warn('Alerts data error:', alertsResult.error);
      setRecentAlerts(alertsResult.data || []);

    } catch (error) {
      console.error('Error loading dashboard:', error);
      toast({
        title: "Error",
        description: "Failed to load dashboard data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'destructive';
      case 'error': return 'destructive';
      case 'warning': return 'default';
      case 'info': return 'secondary';
      default: return 'secondary';
    }
  };

  const StatCard = ({ title, value, icon, description, trend, className, onDark = false }) => (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className={`text-sm font-medium ${onDark ? 'text-white/90' : ''}`}>{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold ${onDark ? 'text-white' : ''}`}>{value}</div>
        {description && (
          <p className={`text-xs mt-1 ${onDark ? 'text-white/80' : 'text-muted-foreground'}`}>{description}</p>
        )}
        {trend && (
          <div className={`flex items-center text-xs mt-1 ${onDark ? 'text-white/80' : 'text-muted-foreground'}`}>
            <TrendingUp className="h-3 w-3 mr-1" />
            {trend}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Welcome Screen - No Locations
  if (locations.length === 0 && !showLocationWizard) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <PageHeader
          title={`${getGreeting()}, ${getUserName()}! 👋`}
          subtitle="Welcome to Bot Korp. Let's get you started with automated property care."
          icon={<Bot className="h-6 w-6 text-primary" />}
        />

        <Card className="border-2 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-6">
            <div className="rounded-full bg-primary/10 p-8">
              <MapPin className="h-16 w-16 text-primary" />
            </div>
            <div className="space-y-3 max-w-2xl">
              <h3 className="text-3xl font-bold">Let's Start with Your Location</h3>
              <p className="text-muted-foreground text-lg">
                Before we can set up any services, we need to know where your property is located. 
                This helps us ensure coverage and deploy the right bots for your area.
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Button size="lg" onClick={() => setShowLocationWizard(true)} className="text-lg px-8 py-6">
                <MapPin className="h-6 w-6 mr-2" />
                Add Your First Location
                <ArrowRight className="h-6 w-6 ml-2" />
              </Button>
            </div>

            <div className="pt-8 border-t w-full max-w-xl">
              <h4 className="font-semibold mb-3">What happens next?</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-left">
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    1
                  </div>
                  <div>
                    <p className="font-medium">Add Location</p>
                    <p className="text-muted-foreground text-xs">Tell us where your property is</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    2
                  </div>
                  <div>
                    <p className="font-medium">Choose Services</p>
                    <p className="text-muted-foreground text-xs">Select lawn, pool, or security</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    3
                  </div>
                  <div>
                    <p className="font-medium">Relax</p>
                    <p className="text-muted-foreground text-xs">Let the bots handle it!</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Legal Profile Wizard Modal - Show after location created
  if (showLegalWizard && (createdLocation || locations.length > 0)) {
    const locationForWizard = createdLocation || locations[0];
    
    return (
      <div className="p-4 md:p-6 space-y-6">
        <LegalProfileWizard
          organizationId={selectedOrg.organization_id}
          locationAddress={{
            address: locationForWizard.address,
            city: locationForWizard.city,
            province: locationForWizard.province,
            postal_code: locationForWizard.postal_code
          }}
          onComplete={() => {
            setShowLegalWizard(false);
            toast({
              title: 'Perfect! You\'re all set',
              description: 'Organization legal profile is complete. Now you can add services.',
            });
            // Reload to hide wizard and show dashboard
            loadDashboardData();
            // Navigate to add service page
            setTimeout(() => {
              navigate('/portal/services/add');
            }, 1000);
          }}
          onSkip={() => {
            setShowLegalWizard(false);
            toast({
              title: 'Legal profile skipped',
              description: 'You can complete it later in settings. Redirecting to add service...',
            });
            // Navigate to add service page
            setTimeout(() => {
              navigate('/portal/services/add');
            }, 1000);
          }}
          embedded={false}
        />
      </div>
    );
  }

  // Location Wizard Modal
  if (showLocationWizard) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <LocationWizard
          organizationId={selectedOrg.organization_id}
          onComplete={async (newLocation) => {
            setShowLocationWizard(false);
            setCreatedLocation(newLocation);
            
            // Reload data to get updated locations and legal profile
            await loadDashboardData();
            
            // Re-fetch organization legal profile to ensure we have latest data
            const { data: freshOrgLegalProfile } = await supabase
              .from('organization_legal_profiles')
              .select('*')
              .eq('organization_id', selectedOrg.organization_id)
              .single();
            
            // Check if organization legal profile is complete
            if (!freshOrgLegalProfile || !freshOrgLegalProfile.legal_profile_completed) {
              toast({
                title: 'Great! Location created',
                description: 'Next, let\'s complete your organization\'s legal profile for service contracts.',
              });
              setShowLegalWizard(true);
            } else {
              toast({
                title: 'Great! Location created',
                description: 'Now you can add your first service',
              });
              setTimeout(() => {
                navigate('/portal/services/add');
              }, 1000);
            }
          }}
          onCancel={() => setShowLocationWizard(false)}
          embedded={false}
        />
      </div>
    );
  }

  // Get services summary
  const getServicesSummary = () => {
    if (!analytics) return '';
    
    const services = [];
    if (analytics.total_gardens > 0) services.push(`${analytics.total_gardens} garden${analytics.total_gardens > 1 ? 's' : ''}`);
    if (analytics.total_pools > 0) services.push(`${analytics.total_pools} pool${analytics.total_pools > 1 ? 's' : ''}`);
    if (analytics.total_locations > 0) services.push(`${analytics.total_locations} location${analytics.total_locations > 1 ? 's' : ''}`);
    
    if (services.length === 0) return '';
    if (services.length === 1) return services[0];
    if (services.length === 2) return services.join(' and ');
    return services.slice(0, -1).join(', ') + ', and ' + services[services.length - 1];
  };

  // Get location context for subtitle
  const getLocationContext = () => {
    if (!locations || locations.length === 0) return '';
    if (locations.length === 1) {
      const loc = locations[0];
      return ` at ${loc.city || loc.address}${loc.province ? `, ${loc.province}` : ''}`;
    }
    return ` across ${locations.length} locations`;
  };

  // Empty State - No Services, but has locations
  if (!loading && locations.length > 0 && analytics && analytics.total_services === 0) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <PageHeader
          title={`${getGreeting()}, ${getUserName()}! 👋`}
          subtitle="You have locations set up. Now let's add your first service to get started."
          icon={<Bot className="h-6 w-6 text-primary" />}
        />

        <Card className="border-2 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-6">
            <div className="rounded-full bg-primary/10 p-8">
              <Sprout className="h-16 w-16 text-primary" />
            </div>
            <div className="space-y-3 max-w-2xl">
              <h3 className="text-3xl font-bold">Let's Add Your First Service</h3>
              <p className="text-muted-foreground text-lg">
                Choose from lawn care, pool maintenance, or security services to start automating your property with Bot Korp.
              </p>
            </div>
            
            <Button size="lg" onClick={() => navigate('/portal/services/add')} className="text-lg px-8 py-6">
              <Plus className="h-6 w-6 mr-2" />
              Add Your First Service
              <ArrowRight className="h-6 w-6 ml-2" />
            </Button>

            <div className="pt-8 border-t w-full max-w-xl">
              <h4 className="font-semibold mb-3">Available Services</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="p-4 rounded-lg border bg-card hover:shadow-md transition-shadow">
                  <Sprout className="h-8 w-8 text-green-600 mb-2 mx-auto" />
                  <p className="font-medium">Lawn Care</p>
                  <p className="text-muted-foreground text-xs mt-1">Autonomous mowing bots</p>
                </div>
                <div className="p-4 rounded-lg border bg-card hover:shadow-md transition-shadow">
                  <Droplets className="h-8 w-8 text-blue-600 mb-2 mx-auto" />
                  <p className="font-medium">Pool Cleaning</p>
                  <p className="text-muted-foreground text-xs mt-1">Automated pool maintenance</p>
                </div>
                <div className="p-4 rounded-lg border bg-card hover:shadow-md transition-shadow">
                  <AlertCircle className="h-8 w-8 text-amber-600 mb-2 mx-auto" />
                  <p className="font-medium">Security</p>
                  <p className="text-muted-foreground text-xs mt-1">24/7 property monitoring</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title={`${getGreeting()}, ${getUserName()}! 👋`}
        subtitle={
          analytics?.total_bots > 0
            ? `Here's what's happening${getLocationContext()}. ` +
              `You're managing ${analytics.total_bots} bot${analytics.total_bots > 1 ? 's' : ''}` +
              `${getServicesSummary() ? ` across ${getServicesSummary()}` : ''}` +
              `${analytics.total_area_managed_sqm > 0 ? `, covering ${Math.round(analytics.total_area_managed_sqm).toLocaleString()} m²` : ''}.`
            : "Welcome to your Bot Korp dashboard. Let's get started by adding your first bot!"
        }
        icon={<Bot className="h-6 w-6 text-primary" />}
      />

      {/* Invitation Banner */}
      {!loadingInvitations && pendingInvitations.length > 0 && (
        <div className="space-y-3">
          {pendingInvitations.map((invitation) => (
            <Alert key={invitation.id} className="border-2 border-accent/30 bg-accent/5 dark:bg-accent/10">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className="h-10 w-10 rounded-full bg-accent/10 dark:bg-accent/20 flex items-center justify-center shrink-0">
                    <Mail className="h-5 w-5 text-accent" />
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-foreground">
                        Team Invitation
                      </h3>
                      <Badge variant="secondary" className="bg-accent/20 text-accent-foreground">
                        {invitation.role}
                      </Badge>
                    </div>
                    <AlertDescription className="text-foreground/80">
                      <strong>{invitation.inviter?.full_name || invitation.inviter?.first_name}</strong> invited you to join{' '}
                      <strong>{invitation.organization?.name}</strong>
                    </AlertDescription>
                    <p className="text-xs text-muted-foreground">
                      Expires {format(new Date(invitation.expires_at), 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    className="bg-accent hover:bg-accent/90"
                    onClick={() => handleAcceptInvitation(invitation.id)}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-border"
                    onClick={() => handleDeclineInvitation(invitation.id)}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Decline
                  </Button>
                </div>
              </div>
            </Alert>
          ))}
        </div>
      )}

      {/* Upcoming Service Text */}
      {analytics?.upcoming_services_count > 0 && analytics?.next_service_date && (
        <p className="text-muted-foreground">
          <Calendar className="h-4 w-4 inline mr-2" />
          Next service: <span className="font-semibold text-foreground">
            {format(new Date(analytics.next_service_date), 'MMMM d, yyyy')}
          </span> ({analytics.upcoming_services_count} service{analytics.upcoming_services_count > 1 ? 's' : ''} scheduled)
        </p>
      )}

      {/* Setup in Progress - No Bots Yet */}
      {analytics?.total_bots === 0 && analytics?.total_gardens > 0 && (
        <Card className="relative overflow-hidden border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 via-background to-primary/5">
          {/* Animated border effect */}
          <div className="absolute inset-0 border-2 border-primary/20 animate-pulse" />
          
          <CardContent className="py-16 relative">
            <div className="max-w-2xl mx-auto text-center space-y-6">
              {/* Icon with animation */}
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
                <div className="relative h-24 w-24 mx-auto rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg">
                  <Bot className="h-12 w-12 text-white animate-bounce" />
                </div>
              </div>

              {/* Message */}
              <div className="space-y-3">
                <h3 className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                  We're Setting Things Up!
                </h3>
                <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                  Your services are configured and ready. Our team is preparing your bots for deployment.
                </p>
              </div>

              {/* Status indicators */}
              <div className="flex items-center justify-center gap-8 pt-4">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-accent animate-pulse" />
                  <span className="text-sm text-muted-foreground">Services Active</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-sm text-muted-foreground">Bots Deploying</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-secondary animate-pulse" />
                  <span className="text-sm text-muted-foreground">Team Notified</span>
                </div>
              </div>

              {/* Timeline */}
              <div className="pt-8 border-t">
                <p className="text-sm font-semibold text-primary mb-4">What's happening:</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 h-8 w-8 rounded-full bg-accent/10 dark:bg-accent/20 flex items-center justify-center">
                      <Check className="h-4 w-4 text-accent" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Services Configured</p>
                      <p className="text-xs text-muted-foreground">Your lawn areas are mapped</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                      <Loader2 className="h-4 w-4 text-amber-600 animate-spin" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Bot Assignment</p>
                      <p className="text-xs text-muted-foreground">Matching bots to your property</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 h-8 w-8 rounded-full bg-secondary/10 dark:bg-secondary/20 flex items-center justify-center">
                      <Calendar className="h-4 w-4 text-secondary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Installation Soon</p>
                      <p className="text-xs text-muted-foreground">We'll contact you within 24h</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact info */}
              <Alert className="max-w-lg mx-auto bg-primary/5 border-primary/20">
                <AlertCircle className="h-4 w-4 text-primary" />
                <AlertDescription className="text-sm">
                  <strong>Need immediate assistance?</strong> Contact us at{' '}
                  <a href="tel:+27311234567" className="font-semibold text-primary hover:underline">
                    +27 31 123 4567
                  </a>
                </AlertDescription>
              </Alert>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Stats - Only show if bots exist */}
      {analytics?.total_bots > 0 && (
        <>
          {/* Primary Stats Row */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Services This Month"
              value={analytics?.services_completed_this_month ?? 0}
              icon={<CheckCircle className="h-5 w-5 text-white/90" />}
              description="Completed services"
              className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange-dark text-white shadow-lg hover:shadow-xl transition-transform hover:-translate-y-0.5"
              onDark
            />
            <StatCard
              title="Outstanding Issues"
              value={(analytics?.offline_bots ?? 0) + (analytics?.error_bots ?? 0)}
              icon={<AlertTriangle className="h-5 w-5 text-white/90" />}
              description={`${analytics?.offline_bots ?? 0} offline, ${analytics?.error_bots ?? 0} errors`}
              className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-orange-600 to-red-600 text-white shadow-lg hover:shadow-xl transition-transform hover:-translate-y-0.5"
              onDark
            />
            <StatCard
              title="Next Service"
              value={analytics?.next_service_date ? format(new Date(analytics.next_service_date), 'MMM d') : 'None'}
              icon={<Calendar className="h-5 w-5 text-white/90" />}
              description={analytics?.next_service_date ? format(new Date(analytics.next_service_date), 'yyyy') : 'No upcoming'}
              className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-botkorp-slate-blue to-botkorp-silver text-white shadow-lg hover:shadow-xl transition-transform hover:-translate-y-0.5"
              onDark
            />
            <StatCard
              title="Total Bots"
              value={analytics?.total_bots ?? 0}
              icon={<Bot className="h-5 w-5 text-white/90" />}
              description={`${analytics?.operational_bots ?? 0} operational`}
              className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-botkorp-black to-botkorp-slate-blue text-white shadow-lg hover:shadow-xl transition-transform hover:-translate-y-0.5"
              onDark
            />
          </div>

          {/* Runtime Stats Row */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Runtime This Week"
              value={`${Math.round((analytics?.total_runtime_hours ?? 0) / 4.3)}h`}
              icon={<Activity className="h-4 w-4 text-muted-foreground" />}
              description="Average weekly runtime"
            />
            <StatCard
              title="Runtime This Month"
              value={`${Math.round(analytics?.total_runtime_hours ?? 0)}h`}
              icon={<Activity className="h-4 w-4 text-muted-foreground" />}
              description="Total hours active"
            />
            <StatCard
              title="Runtime This Year"
              value={`${Math.round((analytics?.total_runtime_hours ?? 0) * 12)}h`}
              icon={<Activity className="h-4 w-4 text-muted-foreground" />}
              description="Estimated annual runtime"
            />
            <StatCard
              title="Total Gardens"
              value={analytics?.total_gardens ?? 0}
              icon={<Sprout className="h-4 w-4 text-muted-foreground" />}
              description={`${Math.round(analytics?.total_area_managed_sqm || 0)} m² managed`}
            />
          </div>

          {/* Bot Status Widget - Real-time bot data */}
          <MyLocationsBotStatus />

          {/* Alerts Section - Show immediately after stats */}
          {recentAlerts.length > 0 && (
            <Card className="overflow-hidden border-l-4 border-l-orange-500">
              <CardHeader className="bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950/20 dark:to-red-950/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-full bg-white dark:bg-gray-800 flex items-center justify-center shadow-sm">
                      <AlertTriangle className="h-5 w-5 text-orange-500" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Active Alerts</CardTitle>
                      <CardDescription className="text-sm">Requires your attention</CardDescription>
                    </div>
                  </div>
                  <Badge variant="destructive" className="text-lg px-3 py-1">
                    {recentAlerts.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  {recentAlerts.slice(0, 3).map((alert) => (
                    <div
                      key={alert.alert_id}
                      className="flex items-start gap-3 p-4 rounded-xl border-2 border-gray-100 dark:border-gray-800 hover:border-orange-200 dark:hover:border-orange-900 hover:bg-orange-50/50 dark:hover:bg-orange-950/20 transition-all duration-200"
                    >
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${
                        alert.severity === 'critical' 
                          ? 'bg-red-100 dark:bg-red-900/30' 
                          : alert.severity === 'warning'
                          ? 'bg-yellow-100 dark:bg-yellow-900/30'
                          : 'bg-secondary/10 dark:bg-secondary/20'
                      }`}>
                        <AlertTriangle className={`h-5 w-5 ${
                          alert.severity === 'critical' ? 'text-red-600 dark:text-red-400' : 
                          alert.severity === 'warning' ? 'text-yellow-600 dark:text-yellow-400' :
                          'text-secondary'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">{alert.title}</p>
                          <Badge 
                            variant={getSeverityColor(alert.severity)} 
                            className="text-xs capitalize"
                          >
                            {alert.severity}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Bot className="h-3 w-3" />
                          {alert.bot_name} • {alert.location_name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(alert.created_at), 'MMM d, h:mm a')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                {recentAlerts.length > 3 && (
                  <Button variant="outline" className="w-full mt-4" onClick={() => navigate('/portal/alerts')}>
                    View All {recentAlerts.length} Alerts
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Empty State - No Services at all */}
      {!loading && analytics?.total_bots > 0 && analytics?.total_gardens === 0 && analytics?.total_pools === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-6">
            <div className="rounded-full bg-primary/10 p-8">
              <Sprout className="h-16 w-16 text-primary" />
            </div>
            <div className="space-y-3">
              <h3 className="text-3xl font-bold">Get Started with Your First Service</h3>
              <p className="text-muted-foreground max-w-md text-lg">
                Add a garden, pool, or security service to start automating your property maintenance with Bot Korp.
              </p>
            </div>
            <Button size="lg" onClick={() => navigate('/portal/services/add')} className="text-lg px-8 py-6">
              <Plus className="h-6 w-6 mr-2" />
              Add Your First Service
            </Button>
          </CardContent>
        </Card>
      ) : !loading && analytics?.total_bots > 0 && (
        <>
          {/* Quick Action Buttons */}
          <div className="flex items-center justify-end gap-3">
            <Button variant="destructive" size="lg" onClick={handleEmergencyStopAll}>
              <AlertTriangle className="h-5 w-5 mr-2" />
              Emergency Stop All Bots
            </Button>
            <Button onClick={() => navigate('/portal/services/add')} size="lg">
              <Plus className="h-5 w-5 mr-2" />
              Add Service
            </Button>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Bot Status Distribution */}
        <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
          <CardHeader className="bg-gradient-to-r from-accent/5 to-secondary/5 dark:from-accent/10 dark:to-secondary/10">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-full bg-white dark:bg-gray-800 flex items-center justify-center shadow-sm">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Bot Status Distribution</CardTitle>
                <CardDescription className="text-sm">Real-time overview of all bots</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {botStatusData.length > 0 ? (
              <div className="relative">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <defs>
                      {botStatusData.map((entry, index) => (
                        <linearGradient key={`gradient-${index}`} id={`color-${index}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.9}/>
                          <stop offset="100%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.7}/>
                        </linearGradient>
                      ))}
                    </defs>
                    <Pie
                      data={botStatusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ status, percent }) => percent > 0.05 ? `${status} ${(percent * 100).toFixed(0)}%` : ''}
                      outerRadius={95}
                      innerRadius={50}
                      fill="#8884d8"
                      dataKey="count"
                      animationBegin={0}
                      animationDuration={800}
                    >
                      {botStatusData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={`url(#color-${index})`}
                          stroke="white"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                    <Legend 
                      verticalAlign="bottom" 
                      height={36}
                      iconType="circle"
                      formatter={(value) => <span className="text-sm capitalize">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {botStatusData.reduce((sum, item) => sum + item.count, 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">Total Bots</p>
                </div>
              </div>
            ) : (
              <div className="h-[280px] flex flex-col items-center justify-center text-muted-foreground">
                <Bot className="h-12 w-12 mb-2 opacity-20" />
                <p>No bot data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bot Type Distribution */}
        <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
          <CardHeader className="bg-gradient-to-r from-secondary/5 to-muted dark:from-secondary/10 dark:to-muted">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-full bg-white dark:bg-gray-800 flex items-center justify-center shadow-sm">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Bot Type Distribution</CardTitle>
                <CardDescription className="text-sm">Types of bots deployed</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {botTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart 
                  data={botTypeData}
                  margin={{ top: 10, right: 10, left: -10, bottom: 20 }}
                >
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9}/>
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.7}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                  <XAxis 
                    dataKey="bot_type" 
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: '#e5e7eb' }}
                    tickFormatter={(value) => value.replace('_', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                  />
                  <YAxis 
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(59, 130, 246, 0.1)' }} />
                  <Bar 
                    dataKey="count" 
                    fill="url(#barGradient)" 
                    radius={[8, 8, 0, 0]}
                    animationBegin={0}
                    animationDuration={800}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[280px] flex flex-col items-center justify-center text-muted-foreground">
                <Bot className="h-12 w-12 mb-2 opacity-20" />
                <p>No bot data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mowing Activity Chart */}
      {mowingActivity.length > 0 && (
        <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
          <CardHeader className="bg-gradient-to-r from-accent/5 to-accent/10 dark:from-accent/10 dark:to-accent/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-full bg-white dark:bg-gray-800 flex items-center justify-center shadow-sm">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Mowing Activity Trends</CardTitle>
                  <CardDescription className="text-sm">Performance over the last 30 days</CardDescription>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-primary">
                  {mowingActivity.reduce((sum, item) => sum + (item.area_mowed || 0), 0).toFixed(0)}
                </p>
                <p className="text-xs text-muted-foreground">Total m² mowed</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <ResponsiveContainer width="100%" height={340}>
              <LineChart 
                data={mowingActivity}
                margin={{ top: 10, right: 10, left: -10, bottom: 20 }}
              >
                <defs>
                  <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.05}/>
                  </linearGradient>
                  <linearGradient id="sessionsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(date) => format(new Date(date), 'MMM d')}
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: '#e5e7eb' }}
                />
                <YAxis 
                  yAxisId="left"
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  label={{ value: 'Area (m²)', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 12 }}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  label={{ value: 'Sessions', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 12 }}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomLineTooltip />} />
                <Legend 
                  verticalAlign="top" 
                  height={36}
                  iconType="line"
                  formatter={(value) => <span className="text-sm font-medium">{value}</span>}
                />
                <Line 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="area_mowed" 
                  stroke="#10b981" 
                  name="Area Mowed (m²)"
                  strokeWidth={3}
                  dot={{ fill: '#10b981', r: 4, strokeWidth: 2, stroke: 'white' }}
                  activeDot={{ r: 6, strokeWidth: 2 }}
                  animationBegin={0}
                  animationDuration={1000}
                />
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="sessions_count" 
                  stroke="#3b82f6" 
                  name="Mowing Sessions"
                  strokeWidth={3}
                  strokeDasharray="5 5"
                  dot={{ fill: '#3b82f6', r: 4, strokeWidth: 2, stroke: 'white' }}
                  activeDot={{ r: 6, strokeWidth: 2 }}
                  animationBegin={200}
                  animationDuration={1000}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

          {/* Upcoming Services Section */}
          {upcomingServices.length > 0 && (
            <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
              <CardHeader className="bg-gradient-to-r from-secondary/5 to-secondary/10 dark:from-secondary/10 dark:to-secondary/20">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-full bg-white dark:bg-gray-800 flex items-center justify-center shadow-sm">
                    <Calendar className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Upcoming Services</CardTitle>
                    <CardDescription className="text-sm">Scheduled maintenance for your bots</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  {upcomingServices.slice(0, 5).map((service) => (
                    <div
                      key={service.bot_id}
                      className="flex items-start justify-between p-4 rounded-xl border-2 border-gray-100 dark:border-gray-800 hover:border-primary/50 hover:bg-primary/5 dark:hover:bg-primary/10 transition-all duration-200 group"
                    >
                      <div className="flex items-start gap-3 flex-1">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-accent to-accent/80 flex items-center justify-center text-white font-semibold text-sm shadow-md group-hover:scale-110 transition-transform">
                          {service.bot_name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-gray-100">{service.bot_name}</p>
                          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3" />
                            {service.location_name}
                          </p>
                          <Badge variant="outline" className="mt-2 capitalize text-xs">
                            {service.bot_type.replace('_', ' ')}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-right ml-4">
                        <div className="px-3 py-1 rounded-lg bg-accent/10 dark:bg-accent/20 text-accent">
                          <p className="text-sm font-bold">
                            {format(new Date(service.next_service_date), 'MMM d')}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          in {service.days_until_service} day{service.days_until_service !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

