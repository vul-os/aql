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
      default: 'bg-[#FAFAFA] dark:bg-[#1a1a1a] border-2 border-[#E5E7EB] dark:border-[#2a2a2a]',
      primary: 'bg-[#FAFAFA] dark:bg-[#1a1a1a] border-2 border-[#FF6B35]/20 dark:border-[#FF6B35]/30',
      success: 'bg-[#FAFAFA] dark:bg-[#1a1a1a] border-2 border-[#10B981]/20 dark:border-[#10B981]/30',
      warning: 'bg-[#FAFAFA] dark:bg-[#1a1a1a] border-2 border-[#EF4444]/20 dark:border-[#EF4444]/30',
      info: 'bg-[#FAFAFA] dark:bg-[#1a1a1a] border-2 border-[#4F5D75]/20 dark:border-[#4F5D75]/30',
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
      <Card className={`${variantStyles[variant]} ${className} shadow-sm hover:shadow-md transition-all duration-300 group overflow-hidden relative animate-in fade-in slide-in-from-bottom-4 duration-700`}>
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

        <Card className="border-2 border-[#E5E7EB] dark:border-[#2a2a2a] shadow-lg bg-white dark:bg-[#1a1a1a]">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-8">
            <div className="relative">
              <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-[#FF6B35] to-[#E85A2A] flex items-center justify-center shadow-xl">
                <MapPin className="h-12 w-12 text-white" />
              </div>
            </div>
            
            <div className="space-y-4 max-w-2xl">
              <h3 className="text-2xl font-bold text-[#121212] dark:text-white">
                Let's Start with Your Location
              </h3>
              <p className="text-[#4F5D75] dark:text-[#B0B3B8] text-sm leading-relaxed">
                Before we can set up any services, we need to know where your property is located. 
                This helps us ensure coverage and deploy the right bots for your area.
              </p>
            </div>
            
            <Button
              size="lg"
              onClick={() => setShowLocationWizard(true)}
              className="bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] hover:from-[#E85A2A] hover:to-[#FF6B35] shadow-lg hover:shadow-xl transition-all duration-300 text-base px-8 py-6 rounded-xl text-white font-bold"
            >
              <MapPin className="h-5 w-5 mr-2" />
              Add Your First Location
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>

            <div className="pt-12 border-t-2 border-[#E5E7EB] dark:border-[#2a2a2a] w-full max-w-4xl mt-8">
              <h4 className="font-bold text-xs uppercase tracking-[0.1em] mb-6 text-[#121212] dark:text-white">What happens next?</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="flex flex-col items-center text-center gap-4 p-6 rounded-xl bg-[#FAFAFA] dark:bg-[#1a1a1a] hover:bg-white dark:hover:bg-[#2a2a2a] transition-all duration-300 border-2 border-[#E5E7EB] dark:border-[#2a2a2a] shadow-sm hover:shadow-md">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#FF6B35] to-[#E85A2A] flex items-center justify-center text-white font-bold text-lg shadow-md">
                    1
                  </div>
                  <div>
                    <p className="font-bold text-sm mb-1 text-[#121212] dark:text-white">Add Location</p>
                    <p className="text-[#4F5D75] dark:text-[#B0B3B8] text-xs">Tell us where your property is</p>
                  </div>
                </div>
                <div className="flex flex-col items-center text-center gap-4 p-6 rounded-xl bg-[#FAFAFA] dark:bg-[#1a1a1a] hover:bg-white dark:hover:bg-[#2a2a2a] transition-all duration-300 border-2 border-[#E5E7EB] dark:border-[#2a2a2a] shadow-sm hover:shadow-md">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#4F5D75] to-[#6B7A94] flex items-center justify-center text-white font-bold text-lg shadow-md">
                    2
                  </div>
                  <div>
                    <p className="font-bold text-sm mb-1 text-[#121212] dark:text-white">Choose Services</p>
                    <p className="text-[#4F5D75] dark:text-[#B0B3B8] text-xs">Select lawn, pool, or security</p>
                  </div>
                </div>
                <div className="flex flex-col items-center text-center gap-4 p-6 rounded-xl bg-[#FAFAFA] dark:bg-[#1a1a1a] hover:bg-white dark:hover:bg-[#2a2a2a] transition-all duration-300 border-2 border-[#E5E7EB] dark:border-[#2a2a2a] shadow-sm hover:shadow-md">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#10B981] to-[#10B981] flex items-center justify-center text-white font-bold text-lg shadow-md">
                    3
                  </div>
                  <div>
                    <p className="font-bold text-sm mb-1 text-[#121212] dark:text-white">Relax</p>
                    <p className="text-[#4F5D75] dark:text-[#B0B3B8] text-xs">Let the bots handle it!</p>
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

        <Card className="border-2 border-[#E5E7EB] dark:border-[#2a2a2a] shadow-lg bg-white dark:bg-[#1a1a1a]">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-8">
            <div className="relative">
              <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-[#10B981] to-[#10B981] flex items-center justify-center shadow-xl">
                <Sprout className="h-12 w-12 text-white" />
              </div>
            </div>
            
            <div className="space-y-4 max-w-2xl">
              <h3 className="text-2xl font-bold text-[#121212] dark:text-white">
                Let's Add Your First Service
              </h3>
              <p className="text-[#4F5D75] dark:text-[#B0B3B8] text-sm leading-relaxed">
                Choose from lawn care, pool maintenance, or security services to start automating your property with Bot Korp.
              </p>
            </div>
            
            <Button
              size="lg"
              onClick={() => navigate('/portal/services/add')}
              className="bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] hover:from-[#E85A2A] hover:to-[#FF6B35] shadow-lg hover:shadow-xl transition-all duration-300 text-base px-8 py-6 rounded-xl text-white font-bold"
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Your First Service
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>

            <div className="pt-12 border-t-2 border-[#E5E7EB] dark:border-[#2a2a2a] w-full max-w-4xl mt-8">
              <h4 className="font-bold text-xs uppercase tracking-[0.1em] mb-6 text-[#121212] dark:text-white">Available Services</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="group p-6 rounded-xl border-2 border-[#E5E7EB] dark:border-[#2a2a2a] bg-[#FAFAFA] dark:bg-[#1a1a1a] hover:bg-white dark:hover:bg-[#2a2a2a] hover:shadow-lg hover:border-[#10B981]/30 transition-all duration-300 cursor-pointer">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#10B981] to-[#10B981] flex items-center justify-center mx-auto mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                    <Sprout className="h-6 w-6 text-white" />
                  </div>
                  <p className="font-bold text-sm mb-2 text-[#121212] dark:text-white">Lawn Care</p>
                  <p className="text-[#4F5D75] dark:text-[#B0B3B8] text-xs">Autonomous mowing bots for perfect lawns</p>
                </div>
                <div className="group p-6 rounded-xl border-2 border-[#E5E7EB] dark:border-[#2a2a2a] bg-[#FAFAFA] dark:bg-[#1a1a1a] hover:bg-white dark:hover:bg-[#2a2a2a] hover:shadow-lg hover:border-[#4F5D75]/30 transition-all duration-300 cursor-pointer">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#4F5D75] to-[#6B7A94] flex items-center justify-center mx-auto mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                    <Droplets className="h-6 w-6 text-white" />
                  </div>
                  <p className="font-bold text-sm mb-2 text-[#121212] dark:text-white">Pool Cleaning</p>
                  <p className="text-[#4F5D75] dark:text-[#B0B3B8] text-xs">Automated pool maintenance systems</p>
                </div>
                <div className="group p-6 rounded-xl border-2 border-[#E5E7EB] dark:border-[#2a2a2a] bg-[#FAFAFA] dark:bg-[#1a1a1a] hover:bg-white dark:hover:bg-[#2a2a2a] hover:shadow-lg hover:border-[#FF6B35]/30 transition-all duration-300 cursor-pointer">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#FF6B35] to-[#E85A2A] flex items-center justify-center mx-auto mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                    <Shield className="h-6 w-6 text-white" />
                  </div>
                  <p className="font-bold text-sm mb-2 text-[#121212] dark:text-white">Security</p>
                  <p className="text-[#4F5D75] dark:text-[#B0B3B8] text-xs">24/7 property monitoring & alerts</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto min-h-screen">
      <div className="space-y-6">
        {/* Header Section - Soft UI Background */}
        <div className="bg-gradient-to-br from-background via-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-top-3 duration-500">
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
          <div className="space-y-4">
            {pendingInvitations.map((invitation, index) => (
              <div
                key={invitation.id} 
                className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all duration-300 relative overflow-hidden group animate-in fade-in slide-in-from-bottom-3"
                style={{ animationDelay: `${index * 100}ms`, animationDuration: '500ms' }}
              >
                {/* Top accent bar */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-botkorp-orange via-botkorp-orange/80 to-botkorp-orange/60 rounded-t-3xl" />
                <div className="relative pt-2">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shrink-0 shadow-[0_4px_20px_rgb(255,107,53,0.15)] group-hover:shadow-[0_4px_20px_rgb(255,107,53,0.25)] transition-all duration-300">
                        <Mail className="h-6 w-6 text-botkorp-orange" />
                      </div>
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-sm uppercase tracking-wide">
                            Team Invitation
                          </h3>
                          <Badge variant="secondary" className="h-5 px-2.5 text-[10px] font-bold capitalize bg-botkorp-orange/10 text-botkorp-orange border border-botkorp-orange/20">
                            {invitation.role}
                          </Badge>
                        </div>
                        <p className="text-sm">
                          <strong>{invitation.inviter?.full_name || invitation.inviter?.first_name}</strong> invited you to join{' '}
                          <strong>{invitation.organization?.name}</strong>
                        </p>
                        <p className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
                          <Clock className="h-3 w-3" />
                          Expires {format(new Date(invitation.expires_at), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="h-9 text-xs bg-botkorp-orange hover:bg-botkorp-orange/90 text-white shadow-[0_4px_20px_rgb(255,107,53,0.25)] hover:shadow-[0_4px_20px_rgb(255,107,53,0.35)] transition-all duration-300 font-bold uppercase tracking-wide px-4 rounded-xl"
                        onClick={() => handleAcceptInvitation(invitation.id)}
                      >
                        <Check className="h-3.5 w-3.5 mr-1.5" />
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 text-xs border-none bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-red-500 hover:text-white transition-all duration-300 font-bold uppercase tracking-wide px-4 rounded-xl"
                        onClick={() => handleDeclineInvitation(invitation.id)}
                      >
                        <X className="h-3.5 w-3.5 mr-1.5" />
                        Decline
                      </Button>
                    </div>
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
        <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="py-20 px-6">
            <div className="max-w-4xl mx-auto text-center space-y-8">
              {/* Icon */}
              <div className="inline-flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 shadow-[0_8px_30px_rgb(255,107,53,0.15)] animate-in zoom-in-50 duration-500 delay-100">
                <Bot className="h-12 w-12 text-botkorp-orange animate-pulse" />
              </div>

              {/* Message */}
              <div className="space-y-4">
                <h3 className="text-2xl font-bold animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
                  We're Setting Things Up!
                </h3>
                <p className="text-sm text-muted-foreground/70 max-w-2xl mx-auto leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
                  Your services are configured and ready. Our team is preparing your bots for deployment.
                </p>
              </div>

              {/* Status indicators */}
              <div className="flex flex-wrap items-center justify-center gap-4 pt-6">
                <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all">
                  <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_rgb(34,197,94,0.4)]" />
                  <span className="text-sm font-bold uppercase tracking-wide">Services Active</span>
                </div>
                <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all">
                  <Loader2 className="h-4 w-4 text-botkorp-orange animate-spin" />
                  <span className="text-sm font-bold uppercase tracking-wide">Bots Deploying</span>
                </div>
                <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all">
                  <div className="h-3 w-3 rounded-full bg-blue-500" />
                  <span className="text-sm font-bold uppercase tracking-wide">Team Notified</span>
                </div>
              </div>

              {/* Timeline */}
              <div className="pt-12 border-t border-muted/20 max-w-3xl mx-auto">
                <p className="text-xs font-bold uppercase tracking-[0.1em] mb-8">What's happening:</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-green-500/15 to-green-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(34,197,94,0.15)]">
                      <Check className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-bold text-sm mb-1">Services Configured</p>
                      <p className="text-xs text-muted-foreground/60">Your lawn areas are mapped</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                      <Loader2 className="h-5 w-5 text-botkorp-orange animate-spin" />
                    </div>
                    <div>
                      <p className="font-bold text-sm mb-1">Bot Assignment</p>
                      <p className="text-xs text-muted-foreground/60">Matching bots to your property</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(59,130,246,0.15)]">
                      <Calendar className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-bold text-sm mb-1">Installation Soon</p>
                      <p className="text-xs text-muted-foreground/60">We'll contact you within 24h</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact info */}
              <div className="max-w-2xl mx-auto bg-gradient-to-br from-botkorp-orange/10 to-botkorp-orange/5 rounded-2xl p-6 shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shrink-0 shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                    <AlertCircle className="h-5 w-5 text-botkorp-orange" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-sm mb-1">Need immediate assistance?</p>
                    <p className="text-sm text-muted-foreground/70">
                      Contact us at{' '}
                      <a href="tel:+27311234567" className="font-bold text-botkorp-orange hover:underline">
                        +27 31 123 4567
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Stats - Soft UI Layout */}
      {analytics?.total_bots > 0 && (
        <>
          {/* Stats Overview Header */}
          <div className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-3 duration-500">
            <div className="h-1 w-1 bg-botkorp-orange rounded-full" />
            <div className="h-1 w-8 bg-gradient-to-r from-botkorp-orange to-botkorp-orange/60 rounded-full" />
            <h2 className="text-xs font-bold uppercase tracking-[0.15em]">
              System Overview
            </h2>
            <div className="flex-1 h-[1px] bg-gradient-to-r from-muted/30 to-transparent" />
          </div>

          {/* Featured Card - Active Bots Status */}
          <div className="relative overflow-hidden group cursor-pointer rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all duration-700 animate-in fade-in slide-in-from-bottom-3 duration-700">
            {/* Base gradient - Soft colors */}
            <div className="absolute inset-0 bg-gradient-to-br from-botkorp-orange via-botkorp-orange/90 to-botkorp-orange/80" />
            
            {/* Animated grid pattern - subtle industrial feel */}
            <div className="absolute inset-0 opacity-20 dark:opacity-30">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA0MCAwIEwgMCAwIDAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMC41Ii8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] animate-pulse" style={{ animationDuration: '4s' }} />
            </div>
            
            {/* Floating particles - premium effect */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute w-1 h-1 bg-white/40 rounded-full top-[20%] left-[15%] animate-float" style={{ animationDelay: '0s', animationDuration: '8s' }} />
              <div className="absolute w-1.5 h-1.5 bg-white/30 rounded-full top-[60%] left-[25%] animate-float" style={{ animationDelay: '2s', animationDuration: '10s' }} />
              <div className="absolute w-1 h-1 bg-white/40 rounded-full top-[40%] left-[80%] animate-float" style={{ animationDelay: '1s', animationDuration: '9s' }} />
              <div className="absolute w-2 h-2 bg-white/20 rounded-full top-[75%] left-[70%] animate-float" style={{ animationDelay: '3s', animationDuration: '11s' }} />
            </div>
            
            {/* Diagonal light sweep - premium shine effect */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-[2000ms] ease-in-out" style={{ transform: 'skewX(-15deg)' }} />
            </div>
            
            {/* Content */}
            <div className="relative p-8">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="h-20 w-20 rounded-2xl bg-white/25 dark:bg-white/15 backdrop-blur-md flex items-center justify-center shadow-xl border border-white/20 group-hover:scale-110 transition-all duration-500">
                    <Bot className="h-10 w-10 text-white drop-shadow-lg" />
                  </div>
                  <div>
                    <span className="text-xs text-white/70 dark:text-white/60 font-bold uppercase tracking-[0.15em] block mb-1">System Status</span>
                    <div className="text-6xl font-bold text-white tracking-tight drop-shadow-2xl leading-none">
                      <NumberTicker value={analytics?.operational_bots ?? 0} />
                    </div>
                    <p className="text-sm text-white/90 dark:text-white/80 font-semibold mt-2">
                      of <span className="text-2xl font-bold">{analytics?.total_bots ?? 0}</span> bots operational
                    </p>
                  </div>
                </div>
                
                {/* Progress and Status */}
                <div className="space-y-4 min-w-[280px]">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/70 dark:text-white/60 font-medium uppercase tracking-wide">Operational Rate</span>
                      <span className="text-white font-bold text-lg">
                        {Math.round(((analytics?.operational_bots ?? 0) / (analytics?.total_bots || 1)) * 100)}%
                      </span>
                    </div>
                    <div className="h-2.5 bg-white/20 dark:bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
                      <div 
                        className="h-full bg-white rounded-full shadow-lg transition-all duration-1000 ease-out"
                        style={{ width: `${Math.round(((analytics?.operational_bots ?? 0) / (analytics?.total_bots || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <div className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
                      <div className="absolute inset-0 h-3 w-3 rounded-full bg-emerald-400 animate-ping" style={{ animationDuration: '2s' }} />
                    </div>
                    <span className="text-sm text-white/90 dark:text-white/80 font-semibold">All Systems Operational</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Primary Stats Grid - 4 columns */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 animate-in fade-in slide-in-from-bottom-3 duration-700">
            {/* Area Coverage Card */}
            <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 group">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Coverage</span>
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-green-500/15 to-green-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(34,197,94,0.15)] group-hover:scale-110 transition-all duration-300">
                  <Sprout className="h-4 w-4 text-green-600" />
                </div>
              </div>
              <div className="text-3xl font-bold mb-1">
                {Math.round((analytics?.total_area_managed_sqm || 0) / 100) / 10}k
              </div>
              <p className="text-xs text-muted-foreground/60">
                {Math.round(analytics?.total_area_managed_sqm || 0).toLocaleString()} m²
              </p>
              <div className="flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-500/10 px-2 py-1 rounded-lg w-fit mt-2">
                <TrendingUp className="h-3 w-3" />
                +5%
              </div>
            </div>

            {/* Services Done Card */}
            <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 group">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Services</span>
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)] group-hover:scale-110 transition-all duration-300">
                  <CheckCircle className="h-4 w-4 text-botkorp-orange" />
                </div>
              </div>
              <div className="text-3xl font-bold mb-1">
                <NumberTicker value={analytics?.services_completed_this_month ?? 0} />
              </div>
              <p className="text-xs text-muted-foreground/60">Completed this month</p>
              <div className="flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-500/10 px-2 py-1 rounded-lg w-fit mt-2">
                <TrendingUp className="h-3 w-3" />
                +12%
              </div>
            </div>

            {/* Runtime Card */}
            <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 group">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Runtime</span>
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(59,130,246,0.15)] group-hover:scale-110 transition-all duration-300">
                  <Clock className="h-4 w-4 text-blue-600" />
                </div>
              </div>
              <div className="text-3xl font-bold mb-1">{Math.round(analytics?.total_runtime_hours ?? 0)}h</div>
              <p className="text-xs text-muted-foreground/60">Automated maintenance</p>
            </div>

            {/* Active Alerts Card */}
            <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 group">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Alerts</span>
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-red-500/15 to-red-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(239,68,68,0.15)] group-hover:scale-110 transition-all duration-300">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
              </div>
              <div className="text-3xl font-bold mb-1">{(analytics?.offline_bots ?? 0) + (analytics?.error_bots ?? 0)}</div>
              <p className="text-xs text-muted-foreground/60">Requires attention</p>
            </div>
          </div>

          {/* Secondary Stats Grid - 3 columns */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 animate-in fade-in slide-in-from-bottom-3 duration-700">
            {/* Gardens & Locations */}
            <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 group">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Properties</span>
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-purple-500/15 to-purple-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(168,85,247,0.15)] group-hover:scale-110 transition-all duration-300">
                  <Home className="h-4 w-4 text-purple-500" />
                </div>
              </div>
              <div className="text-3xl font-bold mb-1">{analytics?.total_gardens ?? 0}</div>
              <p className="text-xs text-muted-foreground/60">
                {analytics?.total_gardens ?? 0} Garden{analytics?.total_gardens !== 1 ? 's' : ''} • {analytics?.total_locations ?? 0} Location{analytics?.total_locations !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Next Service */}
            <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 group">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Next Service</span>
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-amber-500/15 to-amber-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(245,158,11,0.15)] group-hover:scale-110 transition-all duration-300">
                  <Calendar className="h-4 w-4 text-amber-500" />
                </div>
              </div>
              <div className="text-3xl font-bold mb-1">
                {analytics?.next_service_date ? format(new Date(analytics.next_service_date), 'MMM d') : 'None'}
              </div>
              <p className="text-xs text-muted-foreground/60">
                {analytics?.upcoming_services_count > 0 ? `${analytics.upcoming_services_count} scheduled` : 'No upcoming services'}
              </p>
            </div>

            {/* Quick Actions */}
            <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-6 w-6 rounded-lg bg-botkorp-orange flex items-center justify-center">
                  <Zap className="h-4 w-4 text-white" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Quick Actions</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button 
                  size="sm"
                  className="h-9 flex items-center justify-center gap-1.5 bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-botkorp-orange hover:text-white border-0 text-xs font-medium transition-all duration-300 rounded-xl"
                  onClick={() => navigate('/portal/services/add')}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
                <Button 
                  size="sm"
                  className="h-9 flex items-center justify-center gap-1.5 bg-botkorp-orange hover:bg-botkorp-orange/90 border-0 text-white text-xs font-medium transition-all duration-300 rounded-xl shadow-[0_4px_20px_rgb(255,107,53,0.25)] hover:shadow-[0_4px_20px_rgb(255,107,53,0.35)]"
                  onClick={() => navigate('/portal/bots')}
                >
                  <Bot className="h-3.5 w-3.5" />
                  Bots
                </Button>
              </div>
            </div>
          </div>

          {/* Bot Status Widget - Real-time bot data */}
          <MyLocationsBotStatus />

          {/* Alerts Section - Show immediately after stats */}
          {recentAlerts.length > 0 && (
            <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all animate-in fade-in slide-in-from-bottom-3 duration-500 delay-450">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-red-500/15 to-red-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(239,68,68,0.15)]">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">Active Alerts</h3>
                    <Badge variant="destructive" className="h-5 px-2 text-[10px] font-bold bg-red-500 text-white">
                      {recentAlerts.length}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Requires immediate attention
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {recentAlerts.slice(0, 3).map((alert, index) => (
                  <div
                    key={alert.alert_id}
                    className="flex items-start gap-3 p-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all duration-300 cursor-pointer group animate-in fade-in slide-in-from-left-3"
                    style={{ animationDelay: `${index * 50}ms`, animationDuration: '300ms' }}
                  >
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm ${
                      alert.severity === 'critical' 
                        ? 'bg-red-500' 
                        : alert.severity === 'warning'
                        ? 'bg-amber-500'
                        : 'bg-blue-500'
                    }`}>
                      <AlertTriangle className="h-4 w-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-xs truncate group-hover:text-botkorp-orange transition-colors">{alert.title}</p>
                        <Badge 
                          variant={getSeverityColor(alert.severity)} 
                          className="text-[9px] uppercase font-bold px-2 py-0.5 h-4 capitalize"
                        >
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1.5 truncate">
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
                  className="w-full mt-3 text-xs h-9 border-none bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] hover:bg-red-500 hover:text-white transition-all duration-300 font-medium rounded-xl"
                >
                  View All {recentAlerts.length} Alerts
                  <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {/* Empty State - No Services at all */}
      {!loading && analytics?.total_bots > 0 && analytics?.total_gardens === 0 && analytics?.total_pools === 0 ? (
        <Card className="border-2 border-[#E5E7EB] dark:border-[#2a2a2a] shadow-lg bg-white dark:bg-[#1a1a1a]">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-8">
            <div className="relative">
              <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-[#10B981] to-[#10B981] flex items-center justify-center shadow-xl">
                <Sprout className="h-12 w-12 text-white" />
              </div>
            </div>
            <div className="space-y-4 max-w-2xl">
              <h3 className="text-2xl font-bold text-[#121212] dark:text-white">
                Get Started with Your First Service
              </h3>
              <p className="text-[#4F5D75] dark:text-[#B0B3B8] text-sm leading-relaxed">
                Add a garden, pool, or security service to start automating your property maintenance with Bot Korp.
              </p>
            </div>
            <Button
              size="lg"
              onClick={() => navigate('/portal/services/add')}
              className="bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] hover:from-[#E85A2A] hover:to-[#FF6B35] shadow-lg hover:shadow-xl transition-all duration-300 text-base px-8 py-6 rounded-xl text-white font-bold"
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Your First Service
            </Button>
          </CardContent>
        </Card>
      ) : !loading && analytics?.total_bots > 0 && (
        <>
          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={handleEmergencyStopAll}
              className="h-10 text-xs bg-red-500 hover:bg-red-600 text-white shadow-[0_4px_20px_rgb(239,68,68,0.25)] hover:shadow-[0_4px_20px_rgb(239,68,68,0.35)] transition-all duration-300 font-bold uppercase tracking-wide px-5 rounded-xl"
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              Emergency Stop
            </Button>
            <Button
              size="sm"
              onClick={() => navigate('/portal/services/add')}
              className="h-10 text-xs bg-botkorp-orange hover:bg-botkorp-orange/90 text-white shadow-[0_4px_20px_rgb(255,107,53,0.25)] hover:shadow-[0_4px_20px_rgb(255,107,53,0.35)] transition-all duration-300 font-bold uppercase tracking-wide px-5 rounded-xl"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Service
            </Button>
          </div>

        {/* Charts Section - Two Column Layout */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-1 w-1 bg-botkorp-orange rounded-full" />
            <div className="h-1 w-8 bg-gradient-to-r from-botkorp-orange to-botkorp-orange/60 rounded-full" />
            <h2 className="text-xs font-bold uppercase tracking-[0.15em]">
              Activity & Performance
            </h2>
            <div className="flex-1 h-[1px] bg-gradient-to-r from-muted/30 to-transparent" />
          </div>

          <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
            {/* Mowing Activity Chart - Soft Design */}
            {mowingActivity.length > 0 && (
              <div className="lg:col-span-2 bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all animate-in fade-in slide-in-from-bottom-3 duration-500 delay-500">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold mb-0.5">Mowing Activity</h3>
                    <p className="text-xs text-muted-foreground/60">Area coverage over last 30 days</p>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-500/10 px-2 py-1 rounded-lg">
                    <TrendingUp className="h-3 w-3" />
                    +3.2%
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

            {/* Bot Performance Metrics - Soft Design */}
            <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all animate-in fade-in slide-in-from-bottom-3 duration-500 delay-550">
              <div className="mb-4">
                <h3 className="text-sm font-semibold mb-0.5">Performance</h3>
                <p className="text-xs text-muted-foreground/60">System metrics</p>
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

          {/* Upcoming Services Section - Soft Design */}
          {upcomingServices.length > 0 && (
            <div className="bg-gradient-to-br from-background to-muted/20 rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all animate-in fade-in slide-in-from-bottom-3 duration-500 delay-600">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                  <Calendar className="h-5 w-5 text-botkorp-orange" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Upcoming Services</h3>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Scheduled maintenance
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {upcomingServices.slice(0, 5).map((service, index) => (
                  <div
                    key={service.bot_id}
                    className="flex items-center justify-between p-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all duration-300 cursor-pointer group animate-in fade-in slide-in-from-left-3"
                    style={{ animationDelay: `${index * 50}ms`, animationDuration: '300ms' }}
                  >
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center text-blue-600 font-bold text-xs shadow-[0_2px_10px_rgb(59,130,246,0.1)] flex-shrink-0 group-hover:scale-105 transition-transform duration-300">
                        {service.bot_name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-xs truncate group-hover:text-botkorp-orange transition-colors">{service.bot_name}</p>
                        <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1 truncate">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{service.location_name}</span>
                        </p>
                      </div>
                    </div>
                    <div className="text-right ml-2 flex-shrink-0">
                      <div className="px-2 py-1 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 text-botkorp-orange shadow-[0_2px_10px_rgb(255,107,53,0.1)]">
                        <p className="text-[10px] font-bold whitespace-nowrap">
                          {format(new Date(service.next_service_date), 'MMM d')}
                        </p>
                      </div>
                      <p className="text-[9px] text-muted-foreground/60 mt-1 font-medium">
                        {service.days_until_service}d away
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


