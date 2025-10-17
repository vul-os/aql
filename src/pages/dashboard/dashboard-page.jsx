import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
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
  ArrowRight
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

export default function DashboardPage() {
  const { selectedOrg } = useOutletContext();
  const { user } = useAuth();
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

  const COLORS = ['#2563eb', '#1f2937', '#3b82f6', '#0f172a', '#93c5fd'];

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

  useEffect(() => {
    if (selectedOrg) {
      loadDashboardData();
    }
  }, [selectedOrg]);

  const loadDashboardData = async () => {
    if (!selectedOrg?.organization_id) return;

    try {
      setLoading(true);

      // Check for locations first
      const { data: locationsData } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', selectedOrg.organization_id)
        .eq('is_active', true);

      setLocations(locationsData || []);

      // If no locations, stop here - we'll show the welcome screen
      if (!locationsData || locationsData.length === 0) {
        setLoading(false);
        return;
      }

      // Load all data in parallel for faster loading
      const [
        analyticsResult,
        statusResult,
        typeResult,
        mowingResult,
        servicesResult,
        alertsResult
      ] = await Promise.all([
        supabase.rpc('get_organization_dashboard_analytics', { org_id: selectedOrg.organization_id }),
        supabase.rpc('get_bot_status_distribution', { org_id: selectedOrg.organization_id }),
        supabase.rpc('get_bot_type_distribution', { org_id: selectedOrg.organization_id }),
        supabase.rpc('get_mowing_activity_last_30_days', { org_id: selectedOrg.organization_id }),
        supabase.rpc('get_upcoming_services', { org_id: selectedOrg.organization_id, days_ahead: 30 }),
        supabase.rpc('get_recent_alerts', { org_id: selectedOrg.organization_id, limit_count: 5 })
      ]);

      // Check for errors and set data
      if (analyticsResult.error) throw analyticsResult.error;
      setAnalytics(analyticsResult.data);

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
  if (showLegalWizard && createdLocation) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <LegalProfileWizard
          locationAddress={{
            address: createdLocation.address,
            city: createdLocation.city,
            province: createdLocation.province,
            postal_code: createdLocation.postal_code
          }}
          onComplete={() => {
            setShowLegalWizard(false);
            toast({
              title: 'Perfect! You\'re all set',
              description: 'Your legal profile is complete. Now you can add services.',
            });
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
          onComplete={(newLocation) => {
            setShowLocationWizard(false);
            setCreatedLocation(newLocation);
            loadDashboardData();
            
            // Check if legal profile is complete
            if (!profile?.legal_profile_completed) {
              toast({
                title: 'Great! Location created',
                description: 'Next, let\'s complete your legal profile for service contracts.',
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

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title={`${getGreeting()}, ${getUserName()}! 👋`}
        subtitle={
          analytics?.total_bots > 0
            ? `You're managing ${analytics.total_bots} bot${analytics.total_bots > 1 ? 's' : ''}` +
              `${getServicesSummary() ? ` across ${getServicesSummary()}` : ''}` +
              `${analytics.total_area_managed_sqm > 0 ? `, covering ${Math.round(analytics.total_area_managed_sqm).toLocaleString()} m²` : ''}.`
            : "Welcome to your Bot Korp dashboard. Let's get started by adding your first bot!"
        }
        icon={<Bot className="h-6 w-6 text-primary" />}
      />
      {/* Upcoming Service Text */}
      {analytics?.upcoming_services_count > 0 && analytics?.next_service_date && (
        <p className="text-muted-foreground">
          <Calendar className="h-4 w-4 inline mr-2" />
          Next service: <span className="font-semibold text-foreground">
            {format(new Date(analytics.next_service_date), 'MMMM d, yyyy')}
          </span> ({analytics.upcoming_services_count} service{analytics.upcoming_services_count > 1 ? 's' : ''} scheduled)
        </p>
      )}

      {/* Top Stats (Tech-Nature Fusion brief) */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Services"
          value={analytics?.operational_bots ?? 0}
          icon={<Bot className="h-5 w-5 text-white/90" />}
          description={`${analytics?.total_bots ?? 0} total bots`}
          className="relative overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-transform hover:-translate-y-0.5"
          onDark
        />
        <StatCard
          title="Next Service"
          value={analytics?.next_service_date ? format(new Date(analytics.next_service_date), 'MMM d, yyyy') : '—'}
          icon={<Calendar className="h-5 w-5 text-white/90" />}
          description={analytics?.upcoming_services_count ? `${analytics.upcoming_services_count} scheduled` : 'No upcoming'}
          className="relative overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-transform hover:-translate-y-0.5"
          onDark
        />
        <StatCard
          title="Total Properties"
          value={analytics?.total_locations ?? 0}
          icon={<Home className="h-5 w-5 text-white/90" />}
          className="relative overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-transform hover:-translate-y-0.5"
          onDark
        />
        <StatCard
          title="This Month"
          value={analytics?.services_completed_this_month ?? 0}
          icon={<Activity className="h-5 w-5 text-white/90" />}
          description="Services completed"
          className="relative overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-transform hover:-translate-y-0.5"
          onDark
        />
      </div>

      {/* Insights Section */}
      {insights.length > 0 && (
        <div className="space-y-3">
          {insights.map((insight, index) => (
            <Alert 
              key={index}
              variant={insight.type === 'error' ? 'destructive' : 'default'}
              className={
                insight.type === 'success' ? 'border-green-500 bg-green-50 text-green-900' :
                insight.type === 'warning' ? 'border-yellow-500 bg-yellow-50 text-yellow-900' :
                insight.type === 'error' ? '' :
                'border-blue-500 bg-blue-50 text-blue-900'
              }
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{insight.icon}</div>
                <AlertDescription className="text-base">
                  {insight.message}
                </AlertDescription>
              </div>
            </Alert>
          ))}
        </div>
      )}

      {/* Empty State - No Services */}
      {!loading && analytics?.total_gardens === 0 && analytics?.total_pools === 0 ? (
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
      ) : !loading && (
        <>
          {/* Quick Action Buttons */}
          <div className="flex items-center justify-end gap-3">
            <Button variant="destructive" size="lg">
              <AlertTriangle className="h-5 w-5 mr-2" />
              Emergency Stop All Bots
            </Button>
            <Button onClick={() => navigate('/portal/services/add')} size="lg">
              <Plus className="h-5 w-5 mr-2" />
              Add Service
            </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Operational Bots"
          value={analytics?.operational_bots || 0}
          icon={<Bot className="h-4 w-4 text-muted-foreground" />}
          description={`${analytics?.total_bots || 0} total bots`}
        />
        <StatCard
          title="Total Gardens"
          value={analytics?.total_gardens || 0}
          icon={<Sprout className="h-4 w-4 text-muted-foreground" />}
          description={`${Math.round(analytics?.total_area_managed_sqm || 0)} m² managed`}
        />
        <StatCard
          title="Total Pools"
          value={analytics?.total_pools || 0}
          icon={<Droplets className="h-4 w-4 text-muted-foreground" />}
          description={`${analytics?.pools_needing_maintenance || 0} need maintenance`}
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Locations"
          value={analytics?.total_locations || 0}
          icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Total Runtime"
          value={`${Math.round(analytics?.total_runtime_hours || 0)}h`}
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Offline Bots"
          value={analytics?.offline_bots || 0}
          icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
          description={`${analytics?.error_bots || 0} with errors`}
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {/* Bot Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Bot Status</CardTitle>
            <CardDescription>Current status of all bots</CardDescription>
          </CardHeader>
          <CardContent>
            {botStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={botStatusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ status, percent }) => `${status} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="count"
                  >
                    {botStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No bot data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bot Type Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Bot Types</CardTitle>
            <CardDescription>Distribution of bot types</CardDescription>
          </CardHeader>
          <CardContent>
            {botTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={botTypeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bot_type" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No bot data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mowing Activity Chart */}
      {mowingActivity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Mowing Activity (Last 30 Days)</CardTitle>
            <CardDescription>Area mowed over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={mowingActivity}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(date) => format(new Date(date), 'MMM d')}
                />
                <YAxis />
                <Tooltip 
                  labelFormatter={(date) => format(new Date(date), 'MMM d, yyyy')}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="area_mowed" 
                  stroke="#2563eb" 
                  name="Area (m²)"
                  strokeWidth={2}
                />
                <Line 
                  type="monotone" 
                  dataKey="sessions_count" 
                  stroke="#3b82f6" 
                  name="Sessions"
                  strokeWidth={2}
                />
              </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Bottom Row: Upcoming Services & Recent Alerts */}
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
            {/* Upcoming Services */}
            <Card>
              <CardHeader>
                <CardTitle>Upcoming Services</CardTitle>
                <CardDescription>Bots scheduled for maintenance</CardDescription>
              </CardHeader>
              <CardContent>
                {upcomingServices.length > 0 ? (
                  <div className="space-y-3">
                    {upcomingServices.slice(0, 5).map((service) => (
                      <div
                        key={service.bot_id}
                        className="flex items-start justify-between p-3 rounded-lg border"
                      >
                        <div className="flex-1">
                          <p className="font-medium">{service.bot_name}</p>
                          <p className="text-sm text-muted-foreground">{service.location_name}</p>
                          <Badge variant="outline" className="mt-1">
                            {service.bot_type.replace('_', ' ')}
                          </Badge>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {format(new Date(service.next_service_date), 'MMM d')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            in {service.days_until_service} days
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No upcoming services
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Alerts */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Alerts</CardTitle>
                <CardDescription>Latest notifications from your bots</CardDescription>
              </CardHeader>
              <CardContent>
                {recentAlerts.length > 0 ? (
                  <div className="space-y-3">
                    {recentAlerts.map((alert) => (
                      <div
                        key={alert.alert_id}
                        className="flex items-start gap-3 p-3 rounded-lg border"
                      >
                        <AlertTriangle className={`h-5 w-5 flex-shrink-0 ${
                          alert.severity === 'critical' ? 'text-destructive' : 'text-yellow-500'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-sm">{alert.title}</p>
                            <Badge variant={getSeverityColor(alert.severity)} className="text-xs">
                              {alert.severity}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {alert.bot_name} • {alert.location_name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(alert.created_at), 'MMM d, h:mm a')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No recent alerts
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

