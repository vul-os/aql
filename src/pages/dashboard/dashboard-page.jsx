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
      default: 'border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800',
      primary: 'border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800',
      success: 'border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800',
      warning: 'border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800',
      info: 'border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800',
    };

    const iconBgStyles = {
      default: 'bg-[#E5E7EB] dark:bg-[#2a2a2a]',
      primary: 'bg-[#FF6B35] dark:bg-[#FF6B35]',
      success: 'bg-[#10B981] dark:bg-[#10B981]',
      warning: 'bg-[#EF4444] dark:bg-[#EF4444]',
      info: 'bg-[#4F5D75] dark:bg-[#4F5D75]',
    };

    const iconColorStyles = {
      default: 'text-[#4F5D75] dark:text-[#B0B3B8]',
      primary: 'text-white',
      success: 'text-white',
      warning: 'text-white',
      info: 'text-white',
    };

    const valueColorStyles = {
      default: 'text-[#121212] dark:text-white',
      primary: 'text-[#121212] dark:text-white',
      success: 'text-[#121212] dark:text-white',
      warning: 'text-[#121212] dark:text-white',
      info: 'text-[#121212] dark:text-white',
    };

    const accentBarStyles = {
      default: 'bg-[#B0B3B8]',
      primary: 'bg-gradient-to-r from-[#FF6B35] to-[#E85A2A]',
      success: 'bg-[#10B981]',
      warning: 'bg-[#EF4444]',
      info: 'bg-gradient-to-r from-[#4F5D75] to-[#6B7A94]',
    };
    
    return (
      <Card className={`${variantStyles[variant]} ${className} shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group overflow-hidden relative animate-in fade-in slide-in-from-bottom-4 duration-700 rounded-3xl`}>
        {/* Top accent bar */}
        <div className={`absolute top-0 left-0 right-0 h-1 ${accentBarStyles[variant]}`} />
        
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div className={`${iconBgStyles[variant]} p-2.5 rounded-lg shadow-sm`}>
              {React.cloneElement(icon, { 
                className: `h-5 w-5 ${iconColorStyles[variant]}` 
              })}
            </div>
            {trendValue && (
              <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide ${
                trendValue.startsWith('+') || trendValue.startsWith('↑')
                  ? 'bg-[#10B981]/10 text-[#10B981] dark:bg-[#10B981]/20 dark:text-[#10B981]'
                  : 'bg-[#EF4444]/10 text-[#EF4444] dark:bg-[#EF4444]/20 dark:text-[#EF4444]'
              }`}>
                <TrendingUp className={`h-3 w-3 ${trendValue.startsWith('-') || trendValue.startsWith('↓') ? 'rotate-180' : ''}`} />
                {trendValue}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className={`text-3xl font-bold tracking-tight ${valueColorStyles[variant]}`}>
              {isNumeric && typeof value === 'number' ? (
                <NumberTicker value={value} />
              ) : (
                value
              )}
            </div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#4F5D75] dark:text-[#B0B3B8]">
              {title}
            </p>
            {description && (
              <p className="text-[11px] text-[#B0B3B8] dark:text-[#6B7A94] mt-1">
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
      <div className="p-4 md:p-6 lg:p-8 space-y-8 bg-[#FAFAFA] dark:bg-[#121212] min-h-screen">
        <PageHeader
          title={`${getGreeting()}, ${getUserName()}! 👋`}
          subtitle="Welcome to Bot Korp. Let's get you started with automated property care."
          icon={<Bot />}
        />

        <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] rounded-3xl">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-8">
            <div className="relative">
              <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 flex items-center justify-center shadow-xl">
                <MapPin className="h-12 w-12 text-white" />
              </div>
            </div>
            
            <div className="space-y-4 max-w-2xl">
              <h3 className="text-2xl font-bold">
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
              className="bg-gradient-to-r from-botkorp-orange to-botkorp-orange/90 hover:shadow-xl transition-all duration-300 text-base px-8 py-6 rounded-xl text-white font-bold shadow-[4px_4px_12px_rgba(0,0,0,0.2)]"
            >
              <MapPin className="h-5 w-5 mr-2" />
              Add Your First Location
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>

            <div className="pt-12 w-full max-w-4xl mt-8">
              <h4 className="font-bold text-xs uppercase tracking-[0.1em] mb-6">What happens next?</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgb(0,0,0,0.08)] transition-all duration-300">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 flex items-center justify-center text-white font-bold text-lg shadow-md">
                    1
                  </div>
                  <div>
                    <p className="font-bold text-sm mb-1">Add Location</p>
                    <p className="text-muted-foreground text-xs">Tell us where your property is</p>
                  </div>
                </div>
                <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgb(0,0,0,0.08)] transition-all duration-300">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-white font-bold text-lg shadow-md">
                    2
                  </div>
                  <div>
                    <p className="font-bold text-sm mb-1">Choose Services</p>
                    <p className="text-muted-foreground text-xs">Select lawn, pool, or security</p>
                  </div>
                </div>
                <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgb(0,0,0,0.08)] transition-all duration-300">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white font-bold text-lg shadow-md">
                    3
                  </div>
                  <div>
                    <p className="font-bold text-sm mb-1">Relax</p>
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
      <div className="p-4 md:p-6 lg:p-8 space-y-8 bg-[#FAFAFA] dark:bg-[#121212] min-h-screen">
        <PageHeader
          title={`${getGreeting()}, ${getUserName()}! 👋`}
          subtitle="You have locations set up. Now let's add your first service to get started."
          icon={<Bot />}
        />

        <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] rounded-3xl">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-8">
            <div className="relative">
              <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-xl">
                <Sprout className="h-12 w-12 text-white" />
              </div>
            </div>
            
            <div className="space-y-4 max-w-2xl">
              <h3 className="text-2xl font-bold">
                Let's Add Your First Service
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Choose from lawn care, pool maintenance, or security services to start automating your property with Bot Korp.
              </p>
            </div>
            
            <Button
              size="lg"
              onClick={() => navigate('/portal/services/add')}
              className="bg-gradient-to-r from-botkorp-orange to-botkorp-orange/90 hover:shadow-xl transition-all duration-300 text-base px-8 py-6 rounded-xl text-white font-bold shadow-[4px_4px_12px_rgba(0,0,0,0.2)]"
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Your First Service
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>

            <div className="pt-12 w-full max-w-4xl mt-8">
              <h4 className="font-bold text-xs uppercase tracking-[0.1em] mb-6">Available Services</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="group p-6 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgb(0,0,0,0.08)] transition-all duration-300 cursor-pointer">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center mx-auto mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                    <Sprout className="h-6 w-6 text-white" />
                  </div>
                  <p className="font-bold text-sm mb-2">Lawn Care</p>
                  <p className="text-muted-foreground text-xs">Autonomous mowing bots for perfect lawns</p>
                </div>
                <div className="group p-6 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgb(0,0,0,0.08)] transition-all duration-300 cursor-pointer">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center mx-auto mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                    <Droplets className="h-6 w-6 text-white" />
                  </div>
                  <p className="font-bold text-sm mb-2">Pool Cleaning</p>
                  <p className="text-muted-foreground text-xs">Automated pool maintenance systems</p>
                </div>
                <div className="group p-6 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgb(0,0,0,0.08)] transition-all duration-300 cursor-pointer">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 flex items-center justify-center mx-auto mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                    <Shield className="h-6 w-6 text-white" />
                  </div>
                  <p className="font-bold text-sm mb-2">Security</p>
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
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto min-h-screen">
      <div className="space-y-4">
        {/* Header Section - Compact Soft UI */}
        <div className="bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-2xl p-4 md:p-5 shadow-sm border border-slate-200/50 dark:border-slate-800/50 animate-in fade-in slide-in-from-top-3 duration-500">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-foreground mb-1">
                {getGreeting()}, {getUserName()}! 👋
              </h1>
              <p className="text-xs md:text-sm text-muted-foreground/80 max-w-3xl leading-relaxed">
                {analytics?.total_bots > 0
                  ? `Managing ${analytics.total_bots} bot${analytics.total_bots > 1 ? 's' : ''}${getServicesSummary() ? ` across ${getServicesSummary()}` : ''}${analytics.total_area_managed_sqm > 0 ? `, covering ${Math.round(analytics.total_area_managed_sqm).toLocaleString()} m²` : ''}`
                  : "Welcome to your Bot Korp dashboard"}
              </p>
            </div>
            <div className="hidden md:flex items-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-sm">
                <Bot className="h-5 w-5 text-botkorp-orange" />
              </div>
            </div>
          </div>
        </div>

        {/* Invitation Banner */}
        {!loadingInvitations && pendingInvitations.length > 0 && (
          <div className="space-y-3">
            {pendingInvitations.map((invitation, index) => (
              <div
                key={invitation.id} 
                className="bg-gradient-to-br from-botkorp-orange/10 to-botkorp-orange/5 rounded-xl p-4 shadow-sm border border-botkorp-orange/20 hover:shadow-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
                style={{ animationDelay: `${index * 100}ms`, animationDuration: '300ms' }}
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 flex items-center justify-center shrink-0 shadow-sm">
                      <Mail className="h-4 w-4 text-botkorp-orange" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="font-semibold text-sm">Team Invitation</h3>
                        <Badge variant="secondary" className="h-4 px-2 text-[9px] font-semibold capitalize bg-white/50 dark:bg-white/10 text-botkorp-orange border-0">
                          {invitation.role}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        <strong>{invitation.inviter?.full_name || invitation.inviter?.first_name}</strong> invited you to{' '}
                        <strong>{invitation.organization?.name}</strong>
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-botkorp-orange hover:bg-botkorp-orange/90 text-white font-semibold px-4 rounded-lg shadow-sm"
                      onClick={() => handleAcceptInvitation(invitation.id)}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs font-semibold px-4 rounded-lg hover:bg-destructive hover:text-white hover:border-destructive"
                      onClick={() => handleDeclineInvitation(invitation.id)}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Decline
                    </Button>
                  </div>
                </div>
              </div>
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
        <div className="border rounded-xl p-6 bg-muted/30 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="max-w-3xl mx-auto text-center space-y-4">
            {/* Icon */}
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-xl bg-botkorp-orange/10">
              <Bot className="h-8 w-8 text-botkorp-orange animate-pulse" />
            </div>

            {/* Message */}
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">We're Setting Things Up!</h3>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                Your services are configured. Our team is preparing your bots for deployment.
              </p>
            </div>

            {/* Status indicators */}
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border text-xs">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="font-medium">Services Active</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border text-xs">
                <Loader2 className="h-3 w-3 text-botkorp-orange animate-spin" />
                <span className="font-medium">Bots Deploying</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border text-xs">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="font-medium">Team Notified</span>
              </div>
            </div>

            {/* Timeline */}
            <div className="pt-6 border-t max-w-2xl mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col items-center text-center gap-2 p-4 rounded-lg bg-background border">
                  <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <Check className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-xs mb-0.5">Services Configured</p>
                    <p className="text-[10px] text-muted-foreground">Your lawn areas are mapped</p>
                  </div>
                </div>
                <div className="flex flex-col items-center text-center gap-2 p-4 rounded-lg bg-background border">
                  <div className="h-10 w-10 rounded-lg bg-botkorp-orange/10 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 text-botkorp-orange animate-spin" />
                  </div>
                  <div>
                    <p className="font-semibold text-xs mb-0.5">Bot Assignment</p>
                    <p className="text-[10px] text-muted-foreground">Matching bots to your property</p>
                  </div>
                </div>
                <div className="flex flex-col items-center text-center gap-2 p-4 rounded-lg bg-background border">
                  <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Calendar className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-xs mb-0.5">Installation Soon</p>
                    <p className="text-[10px] text-muted-foreground">We'll contact you within 24h</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact info */}
            <div className="max-w-xl mx-auto bg-botkorp-orange/5 border border-botkorp-orange/20 rounded-lg p-4">
              <div className="flex items-center gap-3 text-left">
                <div className="h-8 w-8 rounded-lg bg-botkorp-orange/10 flex items-center justify-center shrink-0">
                  <AlertCircle className="h-4 w-4 text-botkorp-orange" />
                </div>
                <div>
                  <p className="font-semibold text-xs mb-0.5">Need assistance?</p>
                  <p className="text-xs text-muted-foreground">
                    Contact us at{' '}
                    <a href="tel:+27311234567" className="font-semibold text-botkorp-orange hover:underline">
                      +27 31 123 4567
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Stats - Professional Soft UI */}
      {analytics?.total_bots > 0 && (
        <>
          {/* Stats Overview Header */}
          <div className="flex items-center gap-2 py-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="h-1 w-1 bg-botkorp-orange rounded-full" />
            <div className="h-px w-6 bg-gradient-to-r from-botkorp-orange to-transparent" />
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              System Overview
            </h2>
            <div className="flex-1 h-px bg-gradient-to-r from-muted/30 to-transparent" />
          </div>

          {/* Featured Card - Active Bots Status - Compact Soft UI */}
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-botkorp-orange via-botkorp-orange/95 to-botkorp-orange/90 shadow-lg hover:shadow-xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Subtle pattern overlay */}
            <div className="absolute inset-0 opacity-10">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA0MCAwIEwgMCAwIDAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMC41Ii8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')]" />
            </div>
            
            {/* Content */}
            <div className="relative p-5">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
                    <Bot className="h-7 w-7 text-white" />
                  </div>
                  <div>
                    <span className="text-[10px] text-white/70 font-medium uppercase tracking-wider block mb-0.5">System Status</span>
                    <div className="flex items-baseline gap-2">
                      <div className="text-4xl font-bold text-white tracking-tight leading-none">
                        <NumberTicker value={analytics?.operational_bots ?? 0} />
                      </div>
                      <span className="text-sm text-white/80 font-medium">
                        / {analytics?.total_bots ?? 0} bots operational
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Progress and Status */}
                <div className="space-y-2 min-w-[220px]">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/70 font-medium">Operational Rate</span>
                    <span className="text-white font-semibold">
                      {Math.round(((analytics?.operational_bots ?? 0) / (analytics?.total_bots || 1)) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 bg-white/20 rounded-full overflow-hidden backdrop-blur-sm">
                    <div 
                      className="h-full bg-white rounded-full shadow-sm transition-all duration-1000"
                      style={{ width: `${Math.round(((analytics?.operational_bots ?? 0) / (analytics?.total_bots || 1)) * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" />
                    <span className="text-xs text-white/80 font-medium">All Systems Online</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Primary Stats Grid - 4 columns */}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Area Coverage Card */}
            <div className="bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-xl p-4 shadow-sm border border-slate-200/50 dark:border-slate-800/50 hover:shadow-md transition-all duration-300">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Coverage</span>
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-green-500/15 to-green-500/5 flex items-center justify-center shadow-sm">
                  <Sprout className="h-4 w-4 text-green-600" />
                </div>
              </div>
              <div className="text-2xl font-bold mb-0.5">
                {Math.round((analytics?.total_area_managed_sqm || 0) / 100) / 10}k
              </div>
              <p className="text-xs text-muted-foreground/70">
                {Math.round(analytics?.total_area_managed_sqm || 0).toLocaleString()} m²
              </p>
            </div>

            {/* Services Done Card */}
            <div className="bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-xl p-4 shadow-sm border border-slate-200/50 dark:border-slate-800/50 hover:shadow-md transition-all duration-300">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Services</span>
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-sm">
                  <CheckCircle className="h-4 w-4 text-botkorp-orange" />
                </div>
              </div>
              <div className="text-2xl font-bold mb-0.5">
                <NumberTicker value={analytics?.services_completed_this_month ?? 0} />
              </div>
              <p className="text-xs text-muted-foreground/70">Completed this month</p>
            </div>

            {/* Runtime Card */}
            <div className="bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-xl p-4 shadow-sm border border-slate-200/50 dark:border-slate-800/50 hover:shadow-md transition-all duration-300">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Runtime</span>
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center shadow-sm">
                  <Clock className="h-4 w-4 text-blue-600" />
                </div>
              </div>
              <div className="text-2xl font-bold mb-0.5">{Math.round(analytics?.total_runtime_hours ?? 0)}h</div>
              <p className="text-xs text-muted-foreground/70">Total runtime</p>
            </div>

            {/* Active Alerts Card */}
            <div className="bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-xl p-4 shadow-sm border border-slate-200/50 dark:border-slate-800/50 hover:shadow-md transition-all duration-300">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Alerts</span>
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-red-500/15 to-red-500/5 flex items-center justify-center shadow-sm">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
              </div>
              <div className="text-2xl font-bold mb-0.5">{(analytics?.offline_bots ?? 0) + (analytics?.error_bots ?? 0)}</div>
              <p className="text-xs text-muted-foreground/70">Requires attention</p>
            </div>
          </div>

          {/* Secondary Stats Grid - 3 columns */}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Gardens & Locations */}
            <div className="bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-xl p-4 shadow-sm border border-slate-200/50 dark:border-slate-800/50 hover:shadow-md transition-all duration-300">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Properties</span>
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500/15 to-purple-500/5 flex items-center justify-center shadow-sm">
                  <Home className="h-4 w-4 text-purple-500" />
                </div>
              </div>
              <div className="text-2xl font-bold mb-0.5">{analytics?.total_gardens ?? 0}</div>
              <p className="text-xs text-muted-foreground/70">
                {analytics?.total_gardens ?? 0} Garden{analytics?.total_gardens !== 1 ? 's' : ''} • {analytics?.total_locations ?? 0} Location{analytics?.total_locations !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Next Service */}
            <div className="bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-xl p-4 shadow-sm border border-slate-200/50 dark:border-slate-800/50 hover:shadow-md transition-all duration-300">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Next Service</span>
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-500/15 to-amber-500/5 flex items-center justify-center shadow-sm">
                  <Calendar className="h-4 w-4 text-amber-500" />
                </div>
              </div>
              <div className="text-2xl font-bold mb-0.5">
                {analytics?.next_service_date ? format(new Date(analytics.next_service_date), 'MMM d') : 'None'}
              </div>
              <p className="text-xs text-muted-foreground/70">
                {analytics?.upcoming_services_count > 0 ? `${analytics.upcoming_services_count} scheduled` : 'No upcoming services'}
              </p>
            </div>

            {/* Quick Actions */}
            <div className="bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-xl p-4 shadow-sm border border-slate-200/50 dark:border-slate-800/50 hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center">
                  <Zap className="h-3.5 w-3.5 text-botkorp-orange" />
                </div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Quick Actions</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button 
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-medium shadow-sm"
                  onClick={() => navigate('/portal/services/add')}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
                <Button 
                  size="sm"
                  className="h-8 bg-botkorp-orange hover:bg-botkorp-orange/90 text-white text-xs font-medium shadow-sm"
                  onClick={() => navigate('/portal/bots')}
                >
                  <Bot className="h-3 w-3 mr-1" />
                  Bots
                </Button>
              </div>
            </div>
          </div>

          {/* Bot Status Widget - Real-time bot data */}
          <MyLocationsBotStatus />

          {/* Alerts Section - Show immediately after stats */}
          {recentAlerts.length > 0 && (
            <div className="bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-xl p-4 shadow-sm border border-slate-200/50 dark:border-slate-800/50 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-red-500/15 to-red-500/5 flex items-center justify-center shadow-sm">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">Active Alerts</h3>
                    <Badge variant="destructive" className="h-4 px-1.5 text-[9px] font-semibold bg-red-500 text-white shadow-sm">
                      {recentAlerts.length}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {recentAlerts.slice(0, 3).map((alert, index) => (
                  <div
                    key={alert.alert_id}
                    className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white/50 dark:bg-slate-800/30 hover:bg-white dark:hover:bg-slate-800/50 transition-all duration-200 cursor-pointer group shadow-sm"
                  >
                    <div className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm ${
                      alert.severity === 'critical' 
                        ? 'bg-red-500' 
                        : alert.severity === 'warning'
                        ? 'bg-amber-500'
                        : 'bg-blue-500'
                    }`}>
                      <AlertTriangle className="h-3.5 w-3.5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="font-medium text-xs truncate group-hover:text-botkorp-orange transition-colors">{alert.title}</p>
                        <Badge 
                          variant={getSeverityColor(alert.severity)} 
                          className="text-[8px] uppercase font-semibold px-1.5 py-0 h-3.5 capitalize shadow-sm"
                        >
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground/70 flex items-center gap-1 truncate">
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
                  className="w-full mt-2 text-xs h-8 font-medium hover:bg-red-500 hover:text-white hover:border-red-500 shadow-sm"
                >
                  View All {recentAlerts.length} Alerts
                  <ArrowRight className="h-3 w-3 ml-1.5" />
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {/* Empty State - No Services at all */}
      {!loading && analytics?.total_bots > 0 && analytics?.total_gardens === 0 && analytics?.total_pools === 0 ? (
        <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] rounded-3xl">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-8">
            <div className="relative">
              <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-xl">
                <Sprout className="h-12 w-12 text-white" />
              </div>
            </div>
            <div className="space-y-4 max-w-2xl">
              <h3 className="text-2xl font-bold">
                Get Started with Your First Service
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Add a garden, pool, or security service to start automating your property maintenance with Bot Korp.
              </p>
            </div>
            <Button
              size="lg"
              onClick={() => navigate('/portal/services/add')}
              className="bg-gradient-to-r from-botkorp-orange to-botkorp-orange/90 hover:shadow-xl transition-all duration-300 text-base px-8 py-6 rounded-xl text-white font-bold shadow-[4px_4px_12px_rgba(0,0,0,0.2)]"
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
              className="h-9 text-xs font-semibold px-4"
            >
              <AlertTriangle className="h-3 w-3 mr-1.5" />
              Emergency Stop
            </Button>
            <Button
              size="sm"
              onClick={() => navigate('/portal/services/add')}
              className="h-9 text-xs bg-botkorp-orange hover:bg-botkorp-orange/90 text-white font-semibold px-4"
            >
              <Plus className="h-3 w-3 mr-1.5" />
              Add Service
            </Button>
          </div>

        {/* Charts Section - Two Column Layout */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 py-2">
            <div className="h-1 w-1 bg-botkorp-orange rounded-full" />
            <div className="h-px w-6 bg-gradient-to-r from-botkorp-orange to-transparent" />
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Activity & Performance
            </h2>
            <div className="flex-1 h-px bg-gradient-to-r from-muted/30 to-transparent" />
          </div>

          <div className="grid gap-3 grid-cols-1 lg:grid-cols-3">
            {/* Mowing Activity Chart - Soft UI Design */}
            {mowingActivity.length > 0 && (
              <div className="lg:col-span-2 bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-xl p-4 shadow-sm border border-slate-200/50 dark:border-slate-800/50 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold mb-0.5">Mowing Activity</h3>
                    <p className="text-xs text-muted-foreground/70">Last 30 days</p>
                  </div>
                </div>
              <div>
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
                
                <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-muted/20">
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-0.5 font-medium uppercase tracking-wider">Total Area</p>
                    <p className="text-sm font-bold">
                      {Math.round(mowingActivity.reduce((sum, item) => sum + (item.area_mowed || 0), 0))} m²
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-0.5 font-medium uppercase tracking-wider">Sessions</p>
                    <p className="text-sm font-bold">
                      {mowingActivity.reduce((sum, item) => sum + (item.sessions_count || 0), 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-0.5 font-medium uppercase tracking-wider">Avg/Day</p>
                    <p className="text-sm font-bold">
                      {Math.round(mowingActivity.reduce((sum, item) => sum + (item.area_mowed || 0), 0) / mowingActivity.length)} m²
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

            {/* Bot Performance Metrics - Soft UI Design */}
            <div className="bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-xl p-4 shadow-sm border border-slate-200/50 dark:border-slate-800/50 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="mb-3">
                <h3 className="text-sm font-semibold mb-0.5">Performance</h3>
                <p className="text-xs text-muted-foreground/70">System metrics</p>
              </div>
            <div>
              <div className="space-y-4">
                {/* Operational */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-muted-foreground/70">Operational</span>
                    <span className="text-xs font-bold">
                      {Math.round(((analytics?.operational_bots ?? 0) / (analytics?.total_bots || 1)) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-green-500 rounded-full transition-all duration-1000"
                      style={{ width: `${Math.round(((analytics?.operational_bots ?? 0) / (analytics?.total_bots || 1)) * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Coverage */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-muted-foreground/70">Coverage Rate</span>
                    <span className="text-xs font-bold">92%</span>
                  </div>
                  <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 rounded-full transition-all duration-1000" 
                      style={{ width: '92%' }}
                    />
                  </div>
                </div>

                {/* Efficiency */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-muted-foreground/70">Efficiency</span>
                    <span className="text-xs font-bold">87%</span>
                  </div>
                  <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-botkorp-orange rounded-full transition-all duration-1000" 
                      style={{ width: '87%' }}
                    />
                  </div>
                </div>

                {/* Battery Health */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-muted-foreground/70">Avg Battery</span>
                    <span className="text-xs font-bold">95%</span>
                  </div>
                  <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-green-500 rounded-full transition-all duration-1000" 
                      style={{ width: '95%' }}
                    />
                  </div>
                </div>

                {/* Response Time */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-muted-foreground/70">Response Time</span>
                    <span className="text-xs font-bold">Fast</span>
                  </div>
                  <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-purple-500 rounded-full transition-all duration-1000" 
                      style={{ width: '78%' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>

          {/* Upcoming Services Section - Soft UI Design */}
          {upcomingServices.length > 0 && (
            <div className="bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30 rounded-xl p-4 shadow-sm border border-slate-200/50 dark:border-slate-800/50 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-sm">
                  <Calendar className="h-4 w-4 text-botkorp-orange" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Upcoming Services</h3>
                </div>
              </div>

              <div className="space-y-2">
                {upcomingServices.slice(0, 5).map((service, index) => (
                  <div
                    key={service.bot_id}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-white/50 dark:bg-slate-800/30 hover:bg-white dark:hover:bg-slate-800/50 transition-all duration-200 cursor-pointer group shadow-sm"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center text-blue-600 font-semibold text-xs flex-shrink-0 shadow-sm">
                        {service.bot_name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-xs truncate group-hover:text-botkorp-orange transition-colors">{service.bot_name}</p>
                        <p className="text-[10px] text-muted-foreground/70 flex items-center gap-1 truncate">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{service.location_name}</span>
                        </p>
                      </div>
                    </div>
                    <div className="text-right ml-2 flex-shrink-0">
                      <div className="px-2 py-0.5 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 text-botkorp-orange shadow-sm">
                        <p className="text-[10px] font-semibold whitespace-nowrap">
                          {format(new Date(service.next_service_date), 'MMM d')}
                        </p>
                      </div>
                      <p className="text-[9px] text-muted-foreground/70 mt-0.5">
                        {service.days_until_service}d
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}


