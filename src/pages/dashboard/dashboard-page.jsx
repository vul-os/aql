import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import LoadingLottie from '@/components/ui/loading-lottie';
import NumberTicker from '@/components/ui/number-ticker';
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
  AlertCircle,
  Clock,
  Clock3,
  Clock9,
  Timer,
  Zap,
  Award,
  BarChart3,
  Target,
  Shield
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

  // Custom Tooltip Component for charts
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
        supabase.rpc('get_mowing_activity_last_30_days', { org_id: selectedOrg.organization_id }),
        supabase.rpc('get_upcoming_services', { org_id: selectedOrg.organization_id, days_ahead: 30 }),
        supabase.rpc('get_recent_alerts', { org_id: selectedOrg.organization_id, limit_count: 5 })
      ]);

      // Safely extract results
      const [analyticsResult, mowingResult, servicesResult, alertsResult] = results.map(r => 
        r.status === 'fulfilled' ? r.value : { error: r.reason, data: null }
      );

      // Check for errors and set data (don't throw, just log warnings)
      if (analyticsResult.error) {
        console.warn('Analytics error:', analyticsResult.error);
        setAnalytics({});
      } else {
        setAnalytics(analyticsResult.data?.[0] || {});
      }

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

  const StatCard = ({ title, value, icon, description, trend, trendValue, className = '', variant = 'default' }) => {
    // Extract numeric value for animation
    const numericValue = typeof value === 'string' ? parseInt(value.replace(/[^0-9]/g, '')) || 0 : value || 0;
    const isNumeric = typeof value === 'number' || !isNaN(numericValue);
    
    const variantStyles = {
      default: 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
      primary: 'bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950/30 dark:to-orange-900/20 border border-orange-200 dark:border-orange-800/30',
      success: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:to-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30',
      warning: 'bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/30 dark:to-red-900/20 border border-red-200 dark:border-red-800/30',
      info: 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/20 border border-blue-200 dark:border-blue-800/30',
    };

    const iconBgStyles = {
      default: 'bg-orange-100 dark:bg-orange-900/40',
      primary: 'bg-orange-500 dark:bg-orange-600',
      success: 'bg-emerald-500 dark:bg-emerald-600',
      warning: 'bg-red-500 dark:bg-red-600',
      info: 'bg-blue-500 dark:bg-blue-600',
    };

    const iconColorStyles = {
      default: 'text-orange-600 dark:text-orange-400',
      primary: 'text-white',
      success: 'text-white',
      warning: 'text-white',
      info: 'text-white',
    };

    const valueColorStyles = {
      default: 'text-gray-900 dark:text-white',
      primary: 'text-orange-700 dark:text-orange-300',
      success: 'text-emerald-700 dark:text-emerald-300',
      warning: 'text-red-700 dark:text-red-300',
      info: 'text-blue-700 dark:text-blue-300',
    };

    const isGradient = variant !== 'default';
    
    return (
      <Card className={`${variantStyles[variant]} ${className} shadow-sm hover:shadow-md transition-all duration-300 group overflow-hidden relative transform hover:scale-[1.01] animate-in fade-in slide-in-from-bottom-4 duration-700`}>
        {/* Shine effect on hover */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 pointer-events-none" />
        
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className={`${iconBgStyles[variant]} p-2 rounded-lg group-hover:scale-105 transition-all duration-300`}>
              {React.cloneElement(icon, { 
                className: `h-4 w-4 ${iconColorStyles[variant]}` 
              })}
            </div>
            {trendValue && (
              <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                trendValue.startsWith('+') || trendValue.startsWith('↑')
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              }`}>
                <TrendingUp className={`h-3 w-3 ${trendValue.startsWith('-') || trendValue.startsWith('↓') ? 'rotate-180' : ''}`} />
                {trendValue}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className={`text-2xl font-bold tracking-tight ${valueColorStyles[variant]}`}>
              {isNumeric && typeof value === 'number' ? (
                <NumberTicker value={value} />
              ) : (
                value
              )}
            </div>
            <p className={`text-xs font-medium ${isGradient ? 'text-gray-700 dark:text-gray-300' : 'text-gray-600 dark:text-gray-400'}`}>
              {title}
            </p>
            {description && (
              <p className={`text-[11px] ${isGradient ? 'text-gray-600 dark:text-gray-400' : 'text-gray-500 dark:text-gray-500'}`}>
                {description}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <LoadingLottie
          src="https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie"
          message="Loading dashboard..."
          size="md"
        />
      </div>
    );
  }

  // Welcome Screen - No Locations
  if (locations.length === 0 && !showLocationWizard) {
    return (
      <div className="p-4 md:p-6 lg:p-8 space-y-8">
        <PageHeader
          title={`${getGreeting()}, ${getUserName()}! 👋`}
          subtitle="Welcome to Bot Korp. Let's get you started with automated property care."
          icon={<Bot />}
        />

        <Card className="border-2 shadow-xl">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-8">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-botkorp-orange/20 blur-2xl animate-pulse" />
              <div className="relative rounded-2xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange-dark p-10 shadow-xl">
                <MapPin className="h-20 w-20 text-white" />
              </div>
            </div>
            
            <div className="space-y-4 max-w-2xl">
              <h3 className="text-2xl font-bold text-foreground">
                Let's Start with Your Location
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Before we can set up any services, we need to know where your property is located. 
                This helps us ensure coverage and deploy the right bots for your area.
              </p>
            </div>
            
            <Button
              size="lg"
              onClick={() => setShowLocationWizard(true)}
              className="bg-gradient-to-r from-botkorp-orange to-botkorp-orange-dark hover:from-botkorp-orange-dark hover:to-botkorp-orange shadow-lg hover:shadow-xl transition-all duration-300 text-base px-8 py-6 rounded-xl"
            >
              <MapPin className="h-5 w-5 mr-2" />
              Add Your First Location
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>

            <div className="pt-12 border-t w-full max-w-4xl mt-8">
              <h4 className="font-semibold text-sm mb-6 text-foreground">What happens next?</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-gradient-to-br from-botkorp-orange/10 to-botkorp-orange/5 hover:from-botkorp-orange/15 hover:to-botkorp-orange/10 transition-all duration-300 border border-botkorp-orange/20">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange-dark flex items-center justify-center text-white font-bold text-base shadow-lg">
                    1
                  </div>
                  <div>
                    <p className="font-semibold text-sm mb-1">Add Location</p>
                    <p className="text-muted-foreground text-xs">Tell us where your property is</p>
                  </div>
                </div>
                <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-gradient-to-br from-botkorp-slate-blue/10 to-botkorp-slate-blue/5 hover:from-botkorp-slate-blue/15 hover:to-botkorp-slate-blue/10 transition-all duration-300 border border-botkorp-slate-blue/20">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-slate-blue to-botkorp-silver flex items-center justify-center text-white font-bold text-base shadow-lg">
                    2
                  </div>
                  <div>
                    <p className="font-semibold text-sm mb-1">Choose Services</p>
                    <p className="text-muted-foreground text-xs">Select lawn, pool, or security</p>
                  </div>
                </div>
                <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-gradient-to-br from-accent/10 to-accent/5 hover:from-accent/15 hover:to-accent/10 transition-all duration-300 border border-accent/20">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-accent to-accent flex items-center justify-center text-white font-bold text-base shadow-lg">
                    3
                  </div>
                  <div>
                    <p className="font-semibold text-sm mb-1">Relax</p>
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
      <div className="p-4 md:p-6 lg:p-8 space-y-8">
        <PageHeader
          title={`${getGreeting()}, ${getUserName()}! 👋`}
          subtitle="You have locations set up. Now let's add your first service to get started."
          icon={<Bot />}
        />

        <Card className="border-2 shadow-xl">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-8">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-accent/20 blur-2xl animate-pulse" />
              <div className="relative rounded-2xl bg-gradient-to-br from-accent to-accent p-10 shadow-xl">
                <Sprout className="h-20 w-20 text-white" />
              </div>
            </div>
            
            <div className="space-y-4 max-w-2xl">
              <h3 className="text-2xl font-bold text-foreground">
                Let's Add Your First Service
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Choose from lawn care, pool maintenance, or security services to start automating your property with Bot Korp.
              </p>
            </div>
            
            <Button
              size="lg"
              onClick={() => navigate('/portal/services/add')}
              className="bg-gradient-to-r from-accent to-accent hover:from-accent/90 hover:to-accent/90 shadow-lg hover:shadow-xl transition-all duration-300 text-base px-8 py-6 rounded-xl"
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Your First Service
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>

            <div className="pt-12 border-t w-full max-w-4xl mt-8">
              <h4 className="font-semibold text-sm mb-6 text-foreground">Available Services</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="group p-6 rounded-2xl border-2 border-accent/30 dark:border-accent/50 bg-gradient-to-br from-accent/5 to-accent/10 dark:from-accent/10 dark:to-accent/20 hover:shadow-xl hover:scale-105 transition-all duration-300 cursor-pointer">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-accent to-accent flex items-center justify-center mx-auto mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <Sprout className="h-6 w-6 text-white" />
                  </div>
                  <p className="font-bold text-sm mb-2 text-foreground">Lawn Care</p>
                  <p className="text-muted-foreground text-xs">Autonomous mowing bots for perfect lawns</p>
                </div>
                <div className="group p-6 rounded-2xl border-2 border-botkorp-slate-blue/30 dark:border-botkorp-slate-blue/50 bg-gradient-to-br from-botkorp-slate-blue/5 to-botkorp-slate-blue/10 dark:from-botkorp-slate-blue/10 dark:to-botkorp-slate-blue/20 hover:shadow-xl hover:scale-105 transition-all duration-300 cursor-pointer">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-slate-blue to-botkorp-silver flex items-center justify-center mx-auto mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <Droplets className="h-6 w-6 text-white" />
                  </div>
                  <p className="font-bold text-sm mb-2 text-foreground">Pool Cleaning</p>
                  <p className="text-muted-foreground text-xs">Automated pool maintenance systems</p>
                </div>
                <div className="group p-6 rounded-2xl border-2 border-botkorp-orange/30 dark:border-botkorp-orange/50 bg-gradient-to-br from-botkorp-orange/5 to-botkorp-orange/10 dark:from-botkorp-orange/10 dark:to-botkorp-orange/20 hover:shadow-xl hover:scale-105 transition-all duration-300 cursor-pointer">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange-dark flex items-center justify-center mx-auto mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <AlertCircle className="h-6 w-6 text-white" />
                  </div>
                  <p className="font-bold text-sm mb-2 text-foreground">Security</p>
                  <p className="text-muted-foreground text-xs">24/7 property monitoring & alerts</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-5 space-y-5 min-h-screen">
      <div className="space-y-5">
        <div className="space-y-3 animate-in fade-in slide-in-from-top-3 duration-500">
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
            icon={<Bot className="h-5 w-5 text-botkorp-orange" />}
          />

        </div>

        {/* Invitation Banner */}
        {!loadingInvitations && pendingInvitations.length > 0 && (
          <div className="space-y-3">
            {pendingInvitations.map((invitation, index) => (
              <Card 
                key={invitation.id} 
                className="border-t-4 border-t-botkorp-orange shadow-md hover:shadow-xl transition-all duration-300 relative overflow-hidden group animate-in fade-in slide-in-from-bottom-3"
                style={{ animationDelay: `${index * 100}ms`, animationDuration: '500ms' }}
              >
                {/* Animated shine effect */}
                <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
                <CardContent className="p-4 relative">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="h-10 w-10 rounded-lg bg-botkorp-orange flex items-center justify-center shrink-0 shadow-sm group-hover:scale-105 transition-transform duration-300">
                        <Mail className="h-5 w-5 text-white" />
                      </div>
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-sm text-foreground">
                            Team Invitation
                          </h3>
                          <Badge variant="secondary" className="h-5 px-2 text-[10px] font-semibold capitalize bg-botkorp-orange/10 text-botkorp-orange border-botkorp-orange/20">
                            {invitation.role}
                          </Badge>
                        </div>
                        <p className="text-sm text-foreground">
                          <strong>{invitation.inviter?.full_name || invitation.inviter?.first_name}</strong> invited you to join{' '}
                          <strong>{invitation.organization?.name}</strong>
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Clock className="h-3 w-3" />
                          Expires {format(new Date(invitation.expires_at), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="h-8 text-xs bg-botkorp-orange hover:bg-botkorp-orange/90 text-white shadow-sm hover:shadow-md transition-all duration-300 active:scale-95 font-medium"
                        onClick={() => handleAcceptInvitation(invitation.id)}
                      >
                        <Check className="h-3.5 w-3.5 mr-1.5" />
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs border-2 hover:border-destructive hover:bg-destructive hover:text-white transition-all duration-300 active:scale-95"
                        onClick={() => handleDeclineInvitation(invitation.id)}
                      >
                        <X className="h-3.5 w-3.5 mr-1.5" />
                        Decline
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
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
        <Card className="border-2 shadow-xl bg-gradient-to-br from-botkorp-orange/5 to-botkorp-orange-dark/5 dark:from-botkorp-orange/10 dark:to-botkorp-orange-dark/10">
          <CardContent className="py-20">
            <div className="max-w-4xl mx-auto text-center space-y-8">
              {/* Icon */}
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-botkorp-orange/20 rounded-full blur-2xl animate-pulse" />
                <div className="relative h-24 w-24 mx-auto rounded-2xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange-dark flex items-center justify-center shadow-xl">
                  <Bot className="h-12 w-12 text-white" />
                </div>
              </div>

              {/* Message */}
              <div className="space-y-4">
                <h3 className="text-2xl font-bold text-foreground">
                  We're Setting Things Up!
                </h3>
                <p className="text-sm text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                  Your services are configured and ready. Our team is preparing your bots for deployment.
                </p>
              </div>

              {/* Status indicators */}
              <div className="flex flex-wrap items-center justify-center gap-4 pt-6">
                <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-accent/10 dark:bg-accent/20 border-2 border-accent/30 dark:border-accent/50 shadow-sm">
                  <div className="h-3 w-3 rounded-full bg-accent animate-pulse" />
                  <span className="text-sm font-semibold text-foreground">Services Active</span>
                </div>
                <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-botkorp-orange/10 dark:bg-botkorp-orange/20 border-2 border-botkorp-orange/30 dark:border-botkorp-orange/50 shadow-sm">
                  <Loader2 className="h-4 w-4 text-botkorp-orange dark:text-botkorp-orange animate-spin" />
                  <span className="text-sm font-semibold text-foreground">Bots Deploying</span>
                </div>
                <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-botkorp-slate-blue/10 dark:bg-botkorp-slate-blue/20 border-2 border-botkorp-slate-blue/30 dark:border-botkorp-slate-blue/50 shadow-sm">
                  <div className="h-3 w-3 rounded-full bg-botkorp-slate-blue" />
                  <span className="text-sm font-semibold text-foreground">Team Notified</span>
                </div>
              </div>

              {/* Timeline */}
              <div className="pt-12 border-t-2 max-w-3xl mx-auto">
                <p className="text-sm font-bold text-foreground mb-8">What's happening:</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-card border-2 border-accent/30 shadow-md hover:shadow-xl transition-shadow duration-300">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-accent to-accent flex items-center justify-center shadow-lg">
                      <Check className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-sm mb-1">Services Configured</p>
                      <p className="text-xs text-muted-foreground">Your lawn areas are mapped</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-card border-2 border-botkorp-orange/30 shadow-md hover:shadow-xl transition-shadow duration-300">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange-dark flex items-center justify-center shadow-lg">
                      <Loader2 className="h-5 w-5 text-white animate-spin" />
                    </div>
                    <div>
                      <p className="font-bold text-sm mb-1">Bot Assignment</p>
                      <p className="text-xs text-muted-foreground">Matching bots to your property</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-card border-2 border-botkorp-slate-blue/30 shadow-md hover:shadow-xl transition-shadow duration-300">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-slate-blue to-botkorp-silver flex items-center justify-center shadow-lg">
                      <Calendar className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-sm mb-1">Installation Soon</p>
                      <p className="text-xs text-muted-foreground">We'll contact you within 24h</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact info */}
              <Card className="max-w-2xl mx-auto bg-gradient-to-r from-botkorp-orange/10 to-botkorp-orange-dark/10 border-2 border-botkorp-orange/30 shadow-lg">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange-dark flex items-center justify-center shrink-0">
                      <AlertCircle className="h-5 w-5 text-white" />
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-foreground mb-1">Need immediate assistance?</p>
                      <p className="text-sm text-muted-foreground">
                        Contact us at{' '}
                        <a href="tel:+27311234567" className="font-bold text-botkorp-orange hover:underline">
                          +27 31 123 4567
                        </a>
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Stats - Only show if bots exist */}
      {analytics?.total_bots > 0 && (
        <>
          {/* Stats Overview Header */}
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-3 duration-500">
            <div className="h-0.5 w-8 bg-botkorp-orange rounded-full" />
            <h2 className="text-sm font-bold uppercase tracking-wide">
              Overview
            </h2>
          </div>

          {/* Primary Stats Row */}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 shadow-sm">
              <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Active Bots</CardTitle>
                <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
                  <Bot className="h-3.5 w-3.5 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-2xl font-bold tabular-nums">{analytics?.operational_bots ?? 0}</div>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">of {analytics?.total_bots ?? 0} total</p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-75 shadow-sm">
              <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Area Coverage</CardTitle>
                <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
                  <Sprout className="h-3.5 w-3.5 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-2xl font-bold tabular-nums">{Math.round((analytics?.total_area_managed_sqm || 0) / 100) / 10}k</div>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">{Math.round(analytics?.total_area_managed_sqm || 0).toLocaleString()} m²</p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-150 shadow-sm">
              <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Services Done</CardTitle>
                <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 dark:bg-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-botkorp-orange transition-all duration-300">
                  <CheckCircle className="h-3.5 w-3.5 text-botkorp-orange group-hover:text-white transition-colors duration-300" />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-2xl font-bold tabular-nums">{analytics?.services_completed_this_month ?? 0}</div>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">This month</p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange hover:shadow-xl transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200 shadow-sm">
              <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Active Alerts</CardTitle>
                <div className="h-8 w-8 rounded-lg bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-red-500 transition-all duration-300">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500 group-hover:text-white transition-colors duration-300" />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-2xl font-bold tabular-nums">{(analytics?.offline_bots ?? 0) + (analytics?.error_bots ?? 0)}</div>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">{analytics?.offline_bots ?? 0} offline, {analytics?.error_bots ?? 0} errors</p>
              </CardContent>
            </Card>
          </div>

          {/* Secondary Stats Row */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange/50 hover:shadow-lg transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-250 shadow-sm">
              <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Runtime</CardTitle>
                <div className="h-7 w-7 rounded-lg bg-botkorp-orange/10 flex items-center justify-center group-hover:scale-110 transition-all duration-300">
                  <Clock className="h-3 w-3 text-botkorp-orange" />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-xl font-bold tabular-nums">{Math.round(analytics?.total_runtime_hours ?? 0)}h</div>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">This month</p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange/50 hover:shadow-lg transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-300 shadow-sm">
              <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Gardens</CardTitle>
                <div className="h-7 w-7 rounded-lg bg-botkorp-orange/10 flex items-center justify-center group-hover:scale-110 transition-all duration-300">
                  <Home className="h-3 w-3 text-botkorp-orange" />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-xl font-bold tabular-nums">{analytics?.total_gardens ?? 0}</div>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">{analytics?.total_locations ?? 0} locations</p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange/50 hover:shadow-lg transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-350 shadow-sm">
              <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Avg Session</CardTitle>
                <div className="h-7 w-7 rounded-lg bg-botkorp-orange/10 flex items-center justify-center group-hover:scale-110 transition-all duration-300">
                  <Timer className="h-3 w-3 text-botkorp-orange" />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-xl font-bold tabular-nums">{Math.round((analytics?.total_runtime_hours ?? 0) / (analytics?.services_completed_this_month || 1))}h</div>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Per service</p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden border-l-4 border-l-botkorp-orange/50 hover:shadow-lg transition-all duration-300 group animate-in fade-in slide-in-from-bottom-3 duration-500 delay-400 shadow-sm">
              <div className="absolute inset-0 bg-botkorp-orange/0 group-hover:bg-botkorp-orange/5 transition-all duration-300" />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Next Service</CardTitle>
                <div className="h-7 w-7 rounded-lg bg-botkorp-orange/10 flex items-center justify-center group-hover:scale-110 transition-all duration-300">
                  <Calendar className="h-3 w-3 text-botkorp-orange" />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-xl font-bold tabular-nums">{analytics?.next_service_date ? format(new Date(analytics.next_service_date), 'MMM d') : 'None'}</div>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">{analytics?.upcoming_services_count > 0 ? `${analytics.upcoming_services_count} scheduled` : 'No upcoming'}</p>
              </CardContent>
            </Card>
          </div>

          {/* Bot Status Widget - Real-time bot data */}
          <MyLocationsBotStatus />

          {/* Alerts Section - Show immediately after stats */}
          {recentAlerts.length > 0 && (
            <Card className="border-t-4 border-t-red-500 shadow-md animate-in fade-in slide-in-from-bottom-3 duration-500 delay-450">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-0.5 w-8 bg-red-500 rounded-full" />
                    <CardTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                      Active Alerts
                      <Badge variant="destructive" className="h-5 px-2 text-[10px] font-semibold">
                        {recentAlerts.length}
                      </Badge>
                    </CardTitle>
                  </div>
                </div>
                <CardDescription className="text-xs mt-1">
                  Requires immediate attention
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 pb-3">
                <div className="space-y-2">
                  {recentAlerts.slice(0, 3).map((alert, index) => (
                    <div
                      key={alert.alert_id}
                      className="flex items-start gap-2 p-3 rounded-lg border hover:border-red-300 hover:bg-red-50/50 dark:hover:bg-red-900/10 transition-all duration-300 group animate-in fade-in slide-in-from-left-3"
                      style={{ animationDelay: `${index * 50}ms`, animationDuration: '300ms' }}
                    >
                      <div className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm ${
                        alert.severity === 'critical' 
                          ? 'bg-red-500' 
                          : alert.severity === 'warning'
                          ? 'bg-orange-500'
                          : 'bg-blue-500'
                      }`}>
                        <AlertTriangle className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <p className="font-semibold text-xs truncate">{alert.title}</p>
                          <Badge 
                            variant={getSeverityColor(alert.severity)} 
                            className="text-[9px] capitalize font-bold px-1.5 py-0.5 h-4"
                          >
                            {alert.severity}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1.5 truncate">
                          <Bot className="h-3 w-3 flex-shrink-0" />
                          <span className="font-medium truncate">{alert.bot_name}</span>
                          <span>•</span>
                          <span className="truncate">{alert.location_name}</span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                {recentAlerts.length > 3 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/portal/alerts')}
                    className="w-full mt-3 text-xs h-8 hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-all duration-300"
                  >
                    View All {recentAlerts.length} Alerts
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Empty State - No Services at all */}
      {!loading && analytics?.total_bots > 0 && analytics?.total_gardens === 0 && analytics?.total_pools === 0 ? (
        <Card className="border-2 shadow-xl">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-8">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-accent/20 blur-2xl animate-pulse" />
              <div className="relative rounded-2xl bg-gradient-to-br from-accent to-accent p-10 shadow-xl">
                <Sprout className="h-20 w-20 text-white" />
              </div>
            </div>
            <div className="space-y-4 max-w-2xl">
              <h3 className="text-2xl font-bold text-foreground">
                Get Started with Your First Service
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Add a garden, pool, or security service to start automating your property maintenance with Bot Korp.
              </p>
            </div>
            <Button
              size="lg"
              onClick={() => navigate('/portal/services/add')}
              className="bg-gradient-to-r from-accent to-accent hover:from-accent/90 hover:to-accent/90 shadow-lg hover:shadow-xl transition-all duration-300 text-base px-8 py-6 rounded-xl"
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Your First Service
            </Button>
          </CardContent>
        </Card>
      ) : !loading && analytics?.total_bots > 0 && (
        <>
          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={handleEmergencyStopAll}
              className="h-8 text-xs shadow-sm hover:shadow-md transition-all duration-300 active:scale-95 font-medium"
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              Emergency Stop
            </Button>
            <Button
              size="sm"
              onClick={() => navigate('/portal/services/add')}
              className="h-8 text-xs bg-botkorp-orange hover:bg-botkorp-orange/90 text-white shadow-sm hover:shadow-md transition-all duration-300 active:scale-95 font-medium"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Service
            </Button>
          </div>

        {/* Charts Section - Two Column Layout */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-8 bg-botkorp-orange rounded-full" />
            <h2 className="text-sm font-bold uppercase tracking-wide">
              Activity & Performance
            </h2>
          </div>

          <div className="grid gap-3 grid-cols-1 lg:grid-cols-3">
            {/* Mowing Activity Chart */}
            {mowingActivity.length > 0 && (
              <Card className="lg:col-span-2 border-t-4 border-t-botkorp-orange shadow-md overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-500 delay-500">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-bold">Mowing Activity</CardTitle>
                      <CardDescription className="text-xs mt-0.5">Area coverage over last 30 days</CardDescription>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-lg h-6">
                      <TrendingUp className="h-3 w-3" />
                      +3.2%
                    </div>
                  </div>
                </CardHeader>
              <CardContent className="pt-4 pb-3">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart 
                    data={mowingActivity}
                    margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                  >
                    <defs>
                      <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.2}/>
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.3} vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(date) => format(new Date(date), 'MMM d')}
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<CustomLineTooltip />} />
                    <Line 
                      type="monotone" 
                      dataKey="area_mowed" 
                      stroke="#10b981" 
                      strokeWidth={2}
                      fill="url(#areaGradient)"
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: 'white' }}
                      animationBegin={0}
                      animationDuration={1500}
                    />
                  </LineChart>
                </ResponsiveContainer>
                
                <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Total Area</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                      {Math.round(mowingActivity.reduce((sum, item) => sum + (item.area_mowed || 0), 0))} m²
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Sessions</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                      {mowingActivity.reduce((sum, item) => sum + (item.sessions_count || 0), 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Avg/Day</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                      {Math.round(mowingActivity.reduce((sum, item) => sum + (item.area_mowed || 0), 0) / mowingActivity.length)} m²
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

            {/* Bot Performance Metrics */}
            <Card className="border-t-4 border-t-botkorp-orange shadow-md animate-in fade-in slide-in-from-bottom-3 duration-500 delay-550">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold">Performance</CardTitle>
                <CardDescription className="text-xs mt-0.5">System metrics</CardDescription>
              </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-4">
                {/* Operational */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Operational</span>
                    <span className="text-xs font-bold text-gray-900 dark:text-white">
                      {Math.round(((analytics?.operational_bots ?? 0) / (analytics?.total_bots || 1)) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                      style={{ width: `${Math.round(((analytics?.operational_bots ?? 0) / (analytics?.total_bots || 1)) * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Coverage */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Coverage Rate</span>
                    <span className="text-xs font-bold text-gray-900 dark:text-white">92%</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 rounded-full transition-all duration-1000" 
                      style={{ width: '92%' }}
                    />
                  </div>
                </div>

                {/* Efficiency */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Efficiency</span>
                    <span className="text-xs font-bold text-gray-900 dark:text-white">87%</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-orange-500 rounded-full transition-all duration-1000" 
                      style={{ width: '87%' }}
                    />
                  </div>
                </div>

                {/* Battery Health */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Avg Battery</span>
                    <span className="text-xs font-bold text-gray-900 dark:text-white">95%</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-green-500 rounded-full transition-all duration-1000" 
                      style={{ width: '95%' }}
                    />
                  </div>
                </div>

                {/* Response Time */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Response Time</span>
                    <span className="text-xs font-bold text-gray-900 dark:text-white">Fast</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-purple-500 rounded-full transition-all duration-1000" 
                      style={{ width: '78%' }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          </div>
        </div>

          {/* Upcoming Services Section */}
          {upcomingServices.length > 0 && (
            <Card className="border-t-4 border-t-botkorp-orange shadow-md animate-in fade-in slide-in-from-bottom-3 duration-500 delay-600">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="h-0.5 w-8 bg-botkorp-orange rounded-full" />
                  <CardTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-botkorp-orange" />
                    Upcoming Services
                  </CardTitle>
                </div>
                <CardDescription className="text-xs mt-1">
                  Scheduled maintenance
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 pb-3">
                <div className="space-y-2">
                  {upcomingServices.slice(0, 5).map((service, index) => (
                    <div
                      key={service.bot_id}
                      className="flex items-center justify-between p-3 rounded-lg border hover:border-botkorp-orange/50 hover:bg-botkorp-orange/5 transition-all duration-300 group animate-in fade-in slide-in-from-left-3"
                      style={{ animationDelay: `${index * 50}ms`, animationDuration: '300ms' }}
                    >
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <div className="h-8 w-8 rounded-lg bg-botkorp-orange flex items-center justify-center text-white font-bold text-xs shadow-sm flex-shrink-0 group-hover:scale-105 transition-transform duration-300">
                          {service.bot_name.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-xs truncate">{service.bot_name}</p>
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{service.location_name}</span>
                          </p>
                        </div>
                      </div>
                      <div className="text-right ml-2 flex-shrink-0">
                        <div className="px-2 py-1 rounded-lg bg-botkorp-orange text-white shadow-sm">
                          <p className="text-[10px] font-bold whitespace-nowrap">
                            {format(new Date(service.next_service_date), 'MMM d')}
                          </p>
                        </div>
                        <p className="text-[9px] text-muted-foreground mt-1">
                          {service.days_until_service}d away
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
    </div>
  );
}


