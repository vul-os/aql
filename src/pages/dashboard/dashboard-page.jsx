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

  const StatCard = ({ title, value, icon, description, trend, className = '', variant = 'default' }) => {
    // Extract numeric value for animation
    const numericValue = typeof value === 'string' ? parseInt(value.replace(/[^0-9]/g, '')) || 0 : value || 0;
    const isNumeric = typeof value === 'number' || !isNaN(numericValue);
    
    const variantStyles = {
      default: 'bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 border-2 border-gray-200/50 dark:border-gray-700/50 hover:border-botkorp-orange/50 dark:hover:border-botkorp-orange/50',
      primary: 'bg-gradient-to-br from-botkorp-orange via-red-500 to-red-600 text-white border-0',
      success: 'bg-gradient-to-br from-emerald-500 via-green-500 to-emerald-600 text-white border-0',
      warning: 'bg-gradient-to-br from-orange-500 via-red-500 to-red-600 text-white border-0',
      info: 'bg-gradient-to-br from-blue-500 via-botkorp-slate-blue to-blue-600 text-white border-0',
    };

    const isGradient = variant !== 'default';
    
    return (
      <Card className={`${variantStyles[variant]} ${className} shadow-lg hover:shadow-2xl transition-all duration-500 group overflow-hidden relative transform hover:scale-[1.02] animate-in fade-in slide-in-from-bottom-4 duration-700`}>
        {/* Animated background effect */}
        {isGradient && (
          <>
            <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/10 to-white/20 pointer-events-none" />
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-white/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
          </>
        )}
        
        {/* Shine effect on hover */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 pointer-events-none" />
        
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-5 px-5">
          <CardTitle className={`text-[10px] font-bold uppercase tracking-widest ${isGradient ? 'text-white/90' : 'text-muted-foreground'}`}>
            {title}
          </CardTitle>
          <div className={`relative p-2.5 rounded-xl ${isGradient ? 'bg-white/20 ring-2 ring-white/30' : 'bg-gradient-to-br from-botkorp-orange/10 to-red-500/10 ring-2 ring-botkorp-orange/20'} group-hover:scale-110 group-hover:rotate-6 transition-all duration-300 shadow-lg`}>
            {React.cloneElement(icon, { 
              className: `h-4 w-4 ${isGradient ? 'text-white' : 'text-botkorp-orange'}` 
            })}
          </div>
        </CardHeader>
        <CardContent className="space-y-1 pb-5 px-5">
          <div className={`text-3xl font-black tracking-tight ${isGradient ? 'text-white drop-shadow-lg' : 'bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-100 bg-clip-text text-transparent'}`}>
            {isNumeric && typeof value === 'number' ? (
              <NumberTicker value={value} />
            ) : (
              value
            )}
          </div>
          {description && (
            <p className={`text-xs font-medium pt-0.5 ${isGradient ? 'text-white/90' : 'text-muted-foreground'}`}>
              {description}
            </p>
          )}
          {trend && (
            <div className={`flex items-center text-xs pt-1 font-semibold ${isGradient ? 'text-white/90' : 'text-emerald-600 dark:text-emerald-400'}`}>
              <TrendingUp className="h-3.5 w-3.5 mr-1" />
              {trend}
            </div>
          )}
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
              <h3 className="text-4xl font-bold text-foreground">
                Let's Start with Your Location
              </h3>
              <p className="text-muted-foreground text-lg leading-relaxed">
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
              <h4 className="font-semibold text-base mb-6 text-foreground">What happens next?</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-gradient-to-br from-botkorp-orange/10 to-botkorp-orange/5 hover:from-botkorp-orange/15 hover:to-botkorp-orange/10 transition-all duration-300 border border-botkorp-orange/20">
                  <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange-dark flex items-center justify-center text-white font-bold text-xl shadow-lg">
                    1
                  </div>
                  <div>
                    <p className="font-semibold text-base mb-1">Add Location</p>
                    <p className="text-muted-foreground text-sm">Tell us where your property is</p>
                  </div>
                </div>
                <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-gradient-to-br from-botkorp-slate-blue/10 to-botkorp-slate-blue/5 hover:from-botkorp-slate-blue/15 hover:to-botkorp-slate-blue/10 transition-all duration-300 border border-botkorp-slate-blue/20">
                  <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-botkorp-slate-blue to-botkorp-silver flex items-center justify-center text-white font-bold text-xl shadow-lg">
                    2
                  </div>
                  <div>
                    <p className="font-semibold text-base mb-1">Choose Services</p>
                    <p className="text-muted-foreground text-sm">Select lawn, pool, or security</p>
                  </div>
                </div>
                <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-gradient-to-br from-accent/10 to-accent/5 hover:from-accent/15 hover:to-accent/10 transition-all duration-300 border border-accent/20">
                  <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-accent to-accent flex items-center justify-center text-white font-bold text-xl shadow-lg">
                    3
                  </div>
                  <div>
                    <p className="font-semibold text-base mb-1">Relax</p>
                    <p className="text-muted-foreground text-sm">Let the bots handle it!</p>
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
              <h3 className="text-4xl font-bold text-foreground">
                Let's Add Your First Service
              </h3>
              <p className="text-muted-foreground text-lg leading-relaxed">
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
              <h4 className="font-semibold text-base mb-6 text-foreground">Available Services</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="group p-6 rounded-2xl border-2 border-accent/30 dark:border-accent/50 bg-gradient-to-br from-accent/5 to-accent/10 dark:from-accent/10 dark:to-accent/20 hover:shadow-xl hover:scale-105 transition-all duration-300 cursor-pointer">
                  <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-accent to-accent flex items-center justify-center mx-auto mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <Sprout className="h-8 w-8 text-white" />
                  </div>
                  <p className="font-bold text-base mb-2 text-foreground">Lawn Care</p>
                  <p className="text-muted-foreground text-sm">Autonomous mowing bots for perfect lawns</p>
                </div>
                <div className="group p-6 rounded-2xl border-2 border-botkorp-slate-blue/30 dark:border-botkorp-slate-blue/50 bg-gradient-to-br from-botkorp-slate-blue/5 to-botkorp-slate-blue/10 dark:from-botkorp-slate-blue/10 dark:to-botkorp-slate-blue/20 hover:shadow-xl hover:scale-105 transition-all duration-300 cursor-pointer">
                  <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-botkorp-slate-blue to-botkorp-silver flex items-center justify-center mx-auto mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <Droplets className="h-8 w-8 text-white" />
                  </div>
                  <p className="font-bold text-base mb-2 text-foreground">Pool Cleaning</p>
                  <p className="text-muted-foreground text-sm">Automated pool maintenance systems</p>
                </div>
                <div className="group p-6 rounded-2xl border-2 border-botkorp-orange/30 dark:border-botkorp-orange/50 bg-gradient-to-br from-botkorp-orange/5 to-botkorp-orange/10 dark:from-botkorp-orange/10 dark:to-botkorp-orange/20 hover:shadow-xl hover:scale-105 transition-all duration-300 cursor-pointer">
                  <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange-dark flex items-center justify-center mx-auto mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <AlertCircle className="h-8 w-8 text-white" />
                  </div>
                  <p className="font-bold text-base mb-2 text-foreground">Security</p>
                  <p className="text-muted-foreground text-sm">24/7 property monitoring & alerts</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      {/* Decorative background elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-20 right-20 w-96 h-96 bg-botkorp-orange/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-20 left-20 w-80 h-80 bg-accent/5 rounded-full blur-3xl animate-pulse delay-75" />
        <div className="absolute top-1/2 left-1/2 w-72 h-72 bg-botkorp-slate-blue/5 rounded-full blur-3xl animate-pulse delay-150" />
      </div>

      <div className="relative z-10 space-y-6">
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
          icon={<Bot />}
        />

        {/* Invitation Banner */}
        {!loadingInvitations && pendingInvitations.length > 0 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-700">
            {pendingInvitations.map((invitation) => (
              <Card key={invitation.id} className="border-2 border-botkorp-slate-blue/30 dark:border-botkorp-slate-blue/50 bg-gradient-to-r from-botkorp-slate-blue/5 to-botkorp-silver/5 dark:from-botkorp-slate-blue/10 dark:to-botkorp-silver/10 shadow-xl hover:shadow-2xl transition-all duration-300 relative overflow-hidden group">
                {/* Animated shine effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                <CardContent className="p-6 relative">
                <div className="flex items-start justify-between gap-6 flex-wrap">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-slate-blue to-botkorp-silver flex items-center justify-center shrink-0 shadow-md">
                      <Mail className="h-6 w-6 text-white" />
                    </div>
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-bold text-lg text-foreground">
                          Team Invitation
                        </h3>
                        <Badge variant="secondary" className="font-semibold">
                          {invitation.role}
                        </Badge>
                      </div>
                      <p className="text-foreground">
                        <strong>{invitation.inviter?.full_name || invitation.inviter?.first_name}</strong> invited you to join{' '}
                        <strong>{invitation.organization?.name}</strong>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Expires {format(new Date(invitation.expires_at), 'MMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <Button
                      size="lg"
                      className="bg-gradient-to-r from-accent to-accent hover:from-accent/90 hover:to-accent/90 shadow-md"
                      onClick={() => handleAcceptInvitation(invitation.id)}
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Accept
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      className="border-2"
                      onClick={() => handleDeclineInvitation(invitation.id)}
                    >
                      <X className="h-4 w-4 mr-2" />
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
                <h3 className="text-4xl font-bold text-foreground">
                  We're Setting Things Up!
                </h3>
                <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
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
                <p className="text-base font-bold text-foreground mb-8">What's happening:</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-card border-2 border-accent/30 shadow-md hover:shadow-xl transition-shadow duration-300">
                    <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-accent to-accent flex items-center justify-center shadow-lg">
                      <Check className="h-7 w-7 text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-base mb-1">Services Configured</p>
                      <p className="text-sm text-muted-foreground">Your lawn areas are mapped</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-card border-2 border-botkorp-orange/30 shadow-md hover:shadow-xl transition-shadow duration-300">
                    <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange-dark flex items-center justify-center shadow-lg">
                      <Loader2 className="h-7 w-7 text-white animate-spin" />
                    </div>
                    <div>
                      <p className="font-bold text-base mb-1">Bot Assignment</p>
                      <p className="text-sm text-muted-foreground">Matching bots to your property</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-card border-2 border-botkorp-slate-blue/30 shadow-md hover:shadow-xl transition-shadow duration-300">
                    <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-botkorp-slate-blue to-botkorp-silver flex items-center justify-center shadow-lg">
                      <Calendar className="h-7 w-7 text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-base mb-1">Installation Soon</p>
                      <p className="text-sm text-muted-foreground">We'll contact you within 24h</p>
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
          {/* Primary Stats Row */}
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Services This Month"
              value={analytics?.services_completed_this_month ?? 0}
              icon={<Award />}
              description="Completed services"
              variant="primary"
            />
            <StatCard
              title="Outstanding Issues"
              value={(analytics?.offline_bots ?? 0) + (analytics?.error_bots ?? 0)}
              icon={<AlertTriangle />}
              description={`${analytics?.offline_bots ?? 0} offline, ${analytics?.error_bots ?? 0} errors`}
              variant="warning"
            />
            <StatCard
              title="Next Service"
              value={analytics?.next_service_date ? format(new Date(analytics.next_service_date), 'MMM d') : 'None'}
              icon={<Calendar />}
              description={analytics?.next_service_date ? format(new Date(analytics.next_service_date), 'yyyy') : 'No upcoming'}
              variant="info"
            />
            <StatCard
              title="Total Bots"
              value={analytics?.total_bots ?? 0}
              icon={<Shield />}
              description={`${analytics?.operational_bots ?? 0} operational`}
              variant="success"
            />
          </div>

          {/* Runtime Stats Row */}
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Runtime This Week"
              value={`${Math.round((analytics?.total_runtime_hours ?? 0) / 4.3)}h`}
              icon={<Clock />}
              description="Average weekly runtime"
              variant="default"
            />
            <StatCard
              title="Runtime This Month"
              value={`${Math.round(analytics?.total_runtime_hours ?? 0)}h`}
              icon={<Clock3 />}
              description="Total hours active"
              variant="default"
            />
            <StatCard
              title="Runtime This Year"
              value={`${Math.round((analytics?.total_runtime_hours ?? 0) * 12)}h`}
              icon={<Clock9 />}
              description="Estimated annual runtime"
              variant="default"
            />
            <StatCard
              title="Total Gardens"
              value={analytics?.total_gardens ?? 0}
              icon={<Sprout />}
              description={`${Math.round(analytics?.total_area_managed_sqm || 0)} m² managed`}
              variant="default"
            />
          </div>

          {/* Bot Status Widget - Real-time bot data */}
          <MyLocationsBotStatus />

          {/* Alerts Section - Show immediately after stats */}
          {recentAlerts.length > 0 && (
            <Card className="border-l-4 border-l-botkorp-orange shadow-2xl bg-gradient-to-br from-botkorp-orange/5 to-destructive/5 dark:from-botkorp-orange/10 dark:to-destructive/10 relative overflow-hidden group animate-in fade-in slide-in-from-bottom-6 duration-700 delay-300">
              {/* Pulse animation on border */}
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-botkorp-orange animate-pulse" />
              
              <CardHeader className="border-b bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-4">
                    <div className="relative group-hover:scale-110 transition-transform duration-300">
                      {/* Glow effect */}
                      <div className="absolute inset-0 bg-botkorp-orange rounded-xl blur-xl opacity-50 group-hover:opacity-75 transition-opacity duration-300" />
                      <div className="relative h-14 w-14 rounded-xl bg-gradient-to-br from-botkorp-orange via-red-500 to-red-600 flex items-center justify-center shadow-2xl ring-4 ring-white/20 dark:ring-white/10">
                        <AlertTriangle className="h-7 w-7 text-white" />
                      </div>
                    </div>
                    <div>
                      <CardTitle className="text-lg font-bold">Active Alerts</CardTitle>
                      <CardDescription className="text-sm">Requires your attention</CardDescription>
                    </div>
                  </div>
                  <Badge variant="destructive" className="text-base px-4 py-2 font-bold shadow-md">
                    {recentAlerts.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  {recentAlerts.slice(0, 3).map((alert, index) => (
                    <div
                      key={alert.alert_id}
                      className="flex items-start gap-4 p-5 rounded-xl border-2 bg-card hover:border-botkorp-orange dark:hover:border-botkorp-orange-dark hover:shadow-lg transition-all duration-300"
                    >
                      <div className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md ${
                        alert.severity === 'critical' 
                          ? 'bg-gradient-to-br from-destructive to-destructive' 
                          : alert.severity === 'warning'
                          ? 'bg-gradient-to-br from-botkorp-orange to-botkorp-orange-dark'
                          : 'bg-gradient-to-br from-botkorp-slate-blue to-botkorp-silver'
                      }`}>
                        <AlertTriangle className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap mb-2">
                          <p className="font-bold text-base text-foreground">{alert.title}</p>
                          <Badge 
                            variant={getSeverityColor(alert.severity)} 
                            className="text-xs capitalize font-semibold"
                          >
                            {alert.severity}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground flex items-center gap-2 mb-1">
                          <Bot className="h-4 w-4" />
                          <span className="font-medium">{alert.bot_name}</span>
                          <span>•</span>
                          <span>{alert.location_name}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(alert.created_at), 'MMM d, h:mm a')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                {recentAlerts.length > 3 && (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => navigate('/portal/alerts')}
                    className="w-full mt-6 border-2 hover:bg-botkorp-orange/5 dark:hover:bg-botkorp-orange/10 hover:border-botkorp-orange transition-all duration-300"
                  >
                    View All {recentAlerts.length} Alerts
                    <ArrowRight className="h-5 w-5 ml-2" />
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
              <h3 className="text-4xl font-bold text-foreground">
                Get Started with Your First Service
              </h3>
              <p className="text-muted-foreground text-lg leading-relaxed">
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
          <div className="flex flex-wrap items-center justify-end gap-4">
            <Button 
              variant="destructive" 
              size="lg" 
              onClick={handleEmergencyStopAll}
              className="shadow-lg hover:shadow-xl transition-all duration-300 font-semibold"
            >
              <AlertTriangle className="h-5 w-5 mr-2" />
              Emergency Stop All Bots
            </Button>
            <Button
              size="lg"
              onClick={() => navigate('/portal/services/add')}
              className="bg-gradient-to-r from-botkorp-orange to-botkorp-orange-dark hover:from-botkorp-orange-dark hover:to-botkorp-orange shadow-lg hover:shadow-xl transition-all duration-300 font-semibold"
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Service
            </Button>
      </div>

        {/* Mowing Activity Chart */}
        {mowingActivity.length > 0 && (
          <Card className="border-2 border-gray-200/50 dark:border-gray-700/50 shadow-2xl hover:shadow-3xl transition-all duration-500 relative overflow-hidden group animate-in fade-in slide-in-from-bottom-6 duration-700 delay-400">
            {/* Animated background gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-blue-500/5 to-purple-500/5 dark:from-emerald-500/10 dark:via-blue-500/10 dark:to-purple-500/10" />
            
            <CardHeader className="border-b bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm relative">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    {/* Animated glow */}
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-green-500 rounded-xl blur-xl opacity-50 group-hover:opacity-75 transition-opacity duration-300" />
                    <div className="relative h-16 w-16 rounded-xl bg-gradient-to-br from-emerald-500 via-green-500 to-emerald-600 flex items-center justify-center shadow-2xl ring-4 ring-white/20 dark:ring-white/10 group-hover:scale-110 transition-transform duration-300">
                      <TrendingUp className="h-8 w-8 text-white" />
                    </div>
                  </div>
                <div>
                  <CardTitle className="text-xl font-bold">Mowing Activity Trends</CardTitle>
                  <CardDescription className="text-sm">Performance over the last 30 days</CardDescription>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-baseline gap-1">
                  <p className="text-3xl font-bold text-foreground">
                    <NumberTicker value={parseInt(mowingActivity.reduce((sum, item) => sum + (item.area_mowed || 0), 0).toFixed(0))} />
                  </p>
                  <span className="text-base text-muted-foreground">m²</span>
                </div>
                <p className="text-sm text-muted-foreground">Total area mowed</p>
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
            <Card className="border-2 border-gray-200/50 dark:border-gray-700/50 shadow-2xl hover:shadow-3xl transition-all duration-500 bg-gradient-to-br from-blue-500/5 via-botkorp-slate-blue/5 to-botkorp-silver/5 dark:from-blue-500/10 dark:via-botkorp-slate-blue/10 dark:to-botkorp-silver/10 relative overflow-hidden group animate-in fade-in slide-in-from-bottom-6 duration-700 delay-500">
              {/* Animated shine effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
              
              <CardHeader className="border-b bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm relative">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    {/* Animated glow */}
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-botkorp-slate-blue rounded-xl blur-xl opacity-50 group-hover:opacity-75 transition-opacity duration-300" />
                    <div className="relative h-16 w-16 rounded-xl bg-gradient-to-br from-blue-500 via-botkorp-slate-blue to-blue-600 flex items-center justify-center shadow-2xl ring-4 ring-white/20 dark:ring-white/10 group-hover:scale-110 transition-transform duration-300">
                      <Calendar className="h-8 w-8 text-white" />
                    </div>
                  </div>
                  <div>
                    <CardTitle className="text-xl font-bold">Upcoming Services</CardTitle>
                    <CardDescription className="text-sm">Scheduled maintenance for your bots</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  {upcomingServices.slice(0, 5).map((service) => (
                    <div
                      key={service.bot_id}
                      className="flex items-start justify-between p-5 rounded-xl border-2 bg-card hover:border-botkorp-slate-blue dark:hover:border-botkorp-silver hover:shadow-lg transition-all duration-300"
                    >
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange-dark flex items-center justify-center text-white font-bold text-xl shadow-md flex-shrink-0">
                          {service.bot_name.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-base text-foreground mb-1">{service.bot_name}</p>
                          <p className="text-sm text-muted-foreground flex items-center gap-2 mb-2">
                            <MapPin className="h-4 w-4 flex-shrink-0" />
                            <span className="truncate">{service.location_name}</span>
                          </p>
                          <Badge variant="outline" className="capitalize text-xs font-semibold">
                            {service.bot_type.replace('_', ' ')}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-center ml-4 flex-shrink-0">
                        <div className="px-4 py-2 rounded-xl bg-gradient-to-br from-botkorp-slate-blue to-botkorp-silver text-white shadow-md">
                          <p className="text-base font-bold">
                            {format(new Date(service.next_service_date), 'MMM d')}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2 font-medium">
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
    </div>
  );
}


