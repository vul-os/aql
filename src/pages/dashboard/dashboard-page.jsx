import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import LoadingLottie from '@/components/ui/loading-lottie';
import { 
  Bot,
  Plus,
  MapPin,
  ArrowRight,
  Sprout,
  Droplets,
  Shield,
  AlertTriangle,
  Activity
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';

// Dashboard hooks
import {
  useDashboardAnalytics,
  useActiveServices,
  useFleetStatus,
  useServiceActivityChart,
  useRecentActivity
} from '@/hooks/dashboard';

// Dashboard components
import {
  SystemHealthCard,
  ActiveBotsKPI,
  TodaysCoverageKPI,
  ActiveAlertsKPI,
  AlertFeed,
  LiveServicesList,
  FleetStatusWidget,
  ServiceActivityChart,
  // V2 Components
  StatusBanner,
  NextActionsCard,
  CompactKPICard,
  CostSavingsKPI,
  WeatherConditionsWidget,
  UpcomingScheduleWidget
} from '@/components/dashboard';

import LocationWizard from '@/components/services/location-wizard';
import LegalProfileWizard from '@/components/services/legal-profile-wizard';

/**
 * Dashboard Page V2 - Professional Dashboard Transformation
 * Follows industry best practices for IoT/property management platforms
 */
export default function DashboardPageV2() {
  const { user, selectedOrg } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [locations, setLocations] = useState([]);
  const [showLocationWizard, setShowLocationWizard] = useState(false);
  const [showLegalWizard, setShowLegalWizard] = useState(false);
  const [createdLocation, setCreatedLocation] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);

  // Fetch dashboard data using custom hooks
  const { data: analytics, isLoading: analyticsLoading } = useDashboardAnalytics(
    selectedOrg?.organization_id
  );
  
  const { data: activeServices, isLoading: servicesLoading } = useActiveServices(
    selectedOrg?.organization_id
  );
  
  const { data: fleetStatus, isLoading: fleetLoading } = useFleetStatus(
    selectedOrg?.organization_id
  );
  
  const { data: chartData, isLoading: chartLoading } = useServiceActivityChart(
    selectedOrg?.organization_id,
    30
  );
  
  const { data: recentActivity, isLoading: activityLoading } = useRecentActivity(
    selectedOrg?.organization_id,
    20
  );

  // Get user's first name for greeting
  const getUserName = () => {
    const fullName = user?.user_metadata?.full_name;
    if (fullName) {
      return fullName.split(' ')[0];
    }
    return 'there';
  };

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  // Load initial data (locations, etc.)
  useEffect(() => {
    if (selectedOrg?.organization_id) {
      loadInitialData();
    }
  }, [selectedOrg]);

  const loadInitialData = async () => {
    try {
      setInitialLoading(true);

      // Load locations
      const { data: locationsData } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', selectedOrg.organization_id)
        .eq('is_active', true);

      setLocations(locationsData || []);

      // Check if we need to show legal wizard
      if (locationsData && locationsData.length > 0) {
        const { data: orgLegalProfile } = await supabase
          .from('organization_legal_profiles')
          .select('*')
          .eq('organization_id', selectedOrg.organization_id)
          .single();

        if (!orgLegalProfile || !orgLegalProfile.legal_profile_completed) {
          setCreatedLocation(locationsData[0]);
          setShowLegalWizard(true);
        }
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  // Handle alert actions
  const handleViewAlert = (alert) => {
    console.log('View alert:', alert);
    // Navigate to alert details or show modal
  };

  const handleDismissAlert = async (alertId) => {
    try {
      const { error } = await supabase
        .from('service_events')
        .update({ resolved: true })
        .eq('id', alertId);

      if (error) throw error;

      toast({
        title: 'Alert Dismissed',
        description: 'The alert has been marked as resolved.',
      });
    } catch (error) {
      console.error('Error dismissing alert:', error);
      toast({
        title: 'Error',
        description: 'Failed to dismiss alert',
        variant: 'destructive'
      });
    }
  };

  // Handle service actions
  const handlePauseService = async (service) => {
    console.log('Pause service:', service);
    // Implement pause logic
  };

  const handleStopService = async (service) => {
    if (!window.confirm('Are you sure you want to stop this service?')) {
      return;
    }
    console.log('Stop service:', service);
    // Implement stop logic
  };

  const handleViewService = (service) => {
    navigate(`/portal/service/${service.service_id}`);
  };

  // Loading state
  if (initialLoading || analyticsLoading) {
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
      <div className="p-4 md:p-6 lg:p-8 space-y-8 bg-gradient-to-br from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 min-h-screen">
        <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-bold mb-2">
            {getGreeting()}, {getUserName()}! 👋
          </h1>
          <p className="text-muted-foreground/70 mb-8 font-medium">
            Welcome to Bot Korp. Let's get you started with automated property care.
          </p>

          <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
            <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-8">
              <div className="relative animate-in zoom-in-50 duration-500 delay-100">
                <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 flex items-center justify-center shadow-[0_8px_30px_rgb(255,107,53,0.25)]">
                  <MapPin className="h-12 w-12 text-white" />
                </div>
              </div>
              
              <div className="space-y-4 max-w-2xl animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200">
                <h2 className="text-2xl font-bold">
                  Let's Start with Your Location
                </h2>
                <p className="text-muted-foreground/70 text-sm leading-relaxed">
                  Before we can set up any services, we need to know where your property is located. 
                  This helps us ensure coverage and deploy the right bots for your area.
                </p>
              </div>
              
              <Button
                size="lg"
                onClick={() => setShowLocationWizard(true)}
                className="bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] transition-all duration-300 active:scale-95 text-base px-8 py-6 rounded-2xl text-white font-bold border-0 animate-in zoom-in-50 duration-500 delay-300"
              >
                <MapPin className="h-5 w-5 mr-2" />
                Add Your First Location
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>

              <div className="pt-12 w-full max-w-4xl mt-8">
                <h3 className="font-bold text-[10px] uppercase tracking-wider mb-6 text-muted-foreground">
                  What happens next?
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {[
                    { num: 1, title: 'Add Location', desc: 'Tell us where your property is', color: 'from-botkorp-orange to-botkorp-orange/90' },
                    { num: 2, title: 'Choose Services', desc: 'Select lawn, pool, or security', color: 'from-blue-500 to-blue-600' },
                    { num: 3, title: 'Relax', desc: 'Let the bots handle it!', color: 'from-green-500 to-green-600' }
                  ].map((step, idx) => (
                    <div 
                      key={step.num} 
                      className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgb(0,0,0,0.08)] transition-all duration-300 animate-in fade-in slide-in-from-bottom-3"
                      style={{ animationDelay: `${(idx + 4) * 50}ms`, animationDuration: '500ms' }}
                    >
                      <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center text-white font-bold text-lg shadow-[0_4px_20px_rgba(0,0,0,0.15)]`}>
                        {step.num}
                      </div>
                      <div>
                        <p className="font-bold text-sm mb-1">{step.title}</p>
                        <p className="text-muted-foreground/70 text-xs">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Legal Profile Wizard Modal
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
            setTimeout(() => {
              navigate('/portal/services/add');
            }, 1000);
          }}
          onSkip={() => {
            setShowLegalWizard(false);
            toast({
              title: 'Legal profile skipped',
              description: 'You can complete it later in settings.',
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
          onComplete={async (newLocation) => {
            setShowLocationWizard(false);
            setCreatedLocation(newLocation);
            await loadInitialData();
            
            const { data: freshOrgLegalProfile } = await supabase
              .from('organization_legal_profiles')
              .select('*')
              .eq('organization_id', selectedOrg.organization_id)
              .single();
            
            if (!freshOrgLegalProfile || !freshOrgLegalProfile.legal_profile_completed) {
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

  // Main Dashboard View
  const hasServices = analytics?.services?.total_services > 0;
  const hasActiveBots = analytics?.bots?.total > 0;

  // DEBUG: Log analytics data
  console.log('🔍 Dashboard Debug:', {
    analytics,
    hasServices,
    hasActiveBots,
    totalServices: analytics?.services?.total_services,
    totalBots: analytics?.bots?.total,
    organizationId: selectedOrg?.organization_id,
    fullAnalytics: JSON.stringify(analytics, null, 2)
  });

  // Empty State - No Services
  if (!hasServices && hasActiveBots === false) {
    return (
      <div className="p-4 md:p-6 lg:p-8 space-y-8 bg-gradient-to-br from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 min-h-screen">
        <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-bold mb-2">
            {getGreeting()}, {getUserName()}! 👋
          </h1>
          <p className="text-muted-foreground mb-8">
            You have locations set up. Now let's add your first service to get started.
          </p>

          <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
            <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-8">
              <div className="relative animate-in zoom-in-50 duration-500 delay-100">
                <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-[0_8px_30px_rgb(34,197,94,0.25)]">
                  <Sprout className="h-12 w-12 text-white" />
                </div>
              </div>
              
              <div className="space-y-4 max-w-2xl animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200">
                <h2 className="text-2xl font-bold">
                  Let's Add Your First Service
                </h2>
                <p className="text-muted-foreground/70 text-sm leading-relaxed">
                  Choose from lawn care, pool maintenance, or security services to start automating your property with Bot Korp.
                </p>
              </div>
              
              <Button
                size="lg"
                onClick={() => navigate('/portal/services/add')}
                className="bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] transition-all duration-300 active:scale-95 text-base px-8 py-6 rounded-2xl text-white font-bold border-0 animate-in zoom-in-50 duration-500 delay-300"
              >
                <Plus className="h-5 w-5 mr-2" />
                Add Your First Service
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>

              <div className="pt-12 w-full max-w-4xl mt-8">
                <h3 className="font-bold text-[10px] uppercase tracking-wider mb-6 text-muted-foreground">
                  Available Services
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {[
                    { icon: Sprout, title: 'Lawn Care', desc: 'Autonomous mowing bots', color: 'from-green-500 to-green-600' },
                    { icon: Droplets, title: 'Pool Cleaning', desc: 'Automated pool maintenance', color: 'from-blue-500 to-blue-600' },
                    { icon: Shield, title: 'Security', desc: '24/7 property monitoring', color: 'from-botkorp-orange to-botkorp-orange/90' }
                  ].map((service, idx) => {
                    const Icon = service.icon;
                    return (
                      <div 
                        key={idx} 
                        className="group p-6 rounded-2xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgb(0,0,0,0.08)] transition-all duration-300 cursor-pointer animate-in fade-in slide-in-from-bottom-3"
                        style={{ animationDelay: `${(idx + 4) * 50}ms`, animationDuration: '500ms' }}
                      >
                        <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${service.color} flex items-center justify-center mx-auto mb-4 shadow-[0_4px_20px_rgba(0,0,0,0.15)] group-hover:scale-110 transition-transform duration-300`}>
                          <Icon className="h-6 w-6 text-white" />
                        </div>
                        <p className="font-bold text-sm mb-2 group-hover:text-botkorp-orange transition-colors duration-300">{service.title}</p>
                        <p className="text-muted-foreground/70 text-xs">{service.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Filter alerts from recent activity
  const activeAlerts = (recentActivity || [])
    .filter(item => item.event_type === 'alert' && !item.resolved)
    .map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      severity: item.severity || 'info',
      bot_name: item.bot_name,
      location_name: item.location_name,
      created_at: item.created_at
    }));

  // Prepare action items (issues that need attention)
  const actionItems = [
    ...(activeAlerts.filter(a => a.severity === 'critical' || a.severity === 'high').map(alert => ({
      id: alert.id,
      title: alert.title,
      description: alert.description,
      severity: alert.severity,
      type: 'alert'
    }))),
    // Add more action items from other sources as needed
  ].slice(0, 5);

  // Calculate system status
  const getSystemStatus = () => {
    const criticalCount = analytics?.alerts?.critical || 0;
    const warningCount = analytics?.alerts?.warning || 0;
    const offlineBots = analytics?.bots?.offline || 0;
    
    if (criticalCount > 0 || offlineBots > 2) return 'critical';
    if (warningCount > 0 || offlineBots > 0) return 'attention';
    return 'operational';
  };

  const systemStatus = getSystemStatus();

  // Mock upcoming services (replace with real data from API)
  const upcomingServices = [
    // This should come from actual scheduled services API
    // For now, empty array until we have real data
  ];

  // Calculate cost savings (example calculation)
  const calculateMonthlySavings = () => {
    const totalServices = analytics?.services?.total_services || 0;
    const avgTraditionalCost = 500; // Average cost per traditional service
    const avgBotServiceCost = 200; // Average cost per bot service
    return totalServices * (avgTraditionalCost - avgBotServiceCost);
  };

  return (
    <div className="p-3 md:p-4 space-y-4 max-w-[1800px] mx-auto min-h-screen">
      {/* Header */}
      <div className="space-y-4 animate-in fade-in slide-in-from-top-3 duration-500">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold mb-1">
              {getGreeting()}, {getUserName()}! 👋
            </h1>
            <p className="text-sm text-muted-foreground/70 font-medium">
              {analytics?.bots?.total > 0 &&
                `Managing ${analytics.bots.total} bot${analytics.bots.total > 1 ? 's' : ''} ${
                  analytics.services?.total_services > 0
                    ? `across ${analytics.services.total_services} service${analytics.services.total_services > 1 ? 's' : ''}`
                    : ''
                }`}
            </p>
          </div>
          <Button
            onClick={() => navigate('/portal/services/add')}
            className="bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] transition-all duration-300 active:scale-95 rounded-2xl border-0 text-white font-bold"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Service
          </Button>
        </div>

        {/* Status Banner - Prominent System Status */}
        <div className="animate-in fade-in slide-in-from-bottom-3 duration-500">
          <StatusBanner
            status={systemStatus}
            issueCount={actionItems.length}
            lastUpdated={new Date().toISOString()}
          />
        </div>

        {/* Compact KPIs - Executive Summary (5 cards) */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-100">
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: '100ms' }}>
            <CompactKPICard
              icon={Activity}
              label="Services Active"
              value={activeServices?.length || 0}
              subtitle={`${analytics?.services?.total_services || 0} total services`}
              trend={{ value: 12, direction: 'up' }}
              color="orange"
              onClick={() => navigate('/portal/services')}
            />
          </div>
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: '150ms' }}>
            <CompactKPICard
              icon={MapPin}
              label="Coverage Today"
              value={`${Math.round((analytics?.services_today?.area_covered_sqm || 0))} m²`}
              subtitle={`${analytics?.services_today?.completed || 0} services done`}
              trend={{ value: 8, direction: 'up' }}
              color="green"
            />
          </div>
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: '200ms' }}>
            <CostSavingsKPI
              monthlySavings={calculateMonthlySavings()}
              comparisonText="vs traditional service"
              trend={{ value: 15, direction: 'up' }}
            />
          </div>
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: '250ms' }}>
            <CompactKPICard
              icon={Bot}
              label="Bots Working"
              value={`${analytics?.bots?.operational || 0}/${analytics?.bots?.total || 0}`}
              subtitle={`${analytics?.bots?.charging || 0} charging`}
              trend={{ value: 0, direction: 'neutral' }}
              color="blue"
              onClick={() => navigate('/admin/bot-management')}
            />
          </div>
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: '300ms' }}>
            <CompactKPICard
              icon={AlertTriangle}
              label="Active Issues"
              value={actionItems.length}
              subtitle={`${analytics?.alerts?.critical || 0} critical`}
              trend={{ value: actionItems.length > 0 ? 100 : 0, direction: actionItems.length > 0 ? 'up' : 'neutral' }}
              color="red"
            />
          </div>
        </div>

        {/* Next Actions or All Clear */}
        <div className="animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200">
          <NextActionsCard
            actions={actionItems}
            onActionClick={(action) => {
              if (action.type === 'alert') {
                handleViewAlert(action);
              }
            }}
          />
        </div>

        {/* Main Content Grid - Two Column Professional Layout */}
        <div className="grid gap-4 lg:grid-cols-[1fr_400px] animate-in fade-in slide-in-from-bottom-3 duration-500 delay-300">
          {/* Left Column - Main Content */}
          <div className="space-y-4">
            {/* Live Services */}
            {activeServices && activeServices.length > 0 && (
              <div className="animate-in fade-in slide-in-from-left-3 duration-500">
                <LiveServicesList
                  services={activeServices}
                  onPause={handlePauseService}
                  onStop={handleStopService}
                  onView={handleViewService}
                />
              </div>
            )}

            {/* Service Activity Chart */}
            <div className="animate-in fade-in slide-in-from-left-3 duration-500 delay-100">
              <ServiceActivityChart
                data={chartData || []}
                timeRange="30d"
              />
            </div>

            {/* Active Alerts - Only if not showing in action items */}
            {activeAlerts.length > actionItems.length && (
              <div className="animate-in fade-in slide-in-from-left-3 duration-500 delay-200">
                <AlertFeed
                  alerts={activeAlerts.slice(actionItems.length)}
                  onDismiss={handleDismissAlert}
                  onView={handleViewAlert}
                  onViewAll={() => console.log('View all alerts')}
                  maxVisible={3}
                />
              </div>
            )}
          </div>

          {/* Right Column - Sidebar Widgets */}
          <div className="space-y-4">
            {/* Weather & Conditions */}
            <div className="animate-in fade-in slide-in-from-right-3 duration-500">
              <WeatherConditionsWidget
                temperature={22}
                condition="clear"
                humidity={65}
                windSpeed={12}
                visibility={10}
                impact="optimal"
              />
            </div>

            {/* Fleet Status */}
            <div className="animate-in fade-in slide-in-from-right-3 duration-500 delay-100">
              <FleetStatusWidget fleetData={fleetStatus} />
            </div>

            {/* Upcoming Schedule */}
            <div className="animate-in fade-in slide-in-from-right-3 duration-500 delay-200">
              <UpcomingScheduleWidget
                upcomingServices={upcomingServices}
                onViewAll={() => navigate('/portal/services')}
              />
            </div>

            {/* Quick Actions - Compact */}
            <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 rounded-3xl animate-in fade-in slide-in-from-right-3 duration-500 delay-300">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 dark:from-botkorp-orange/30 dark:to-botkorp-orange/20 flex items-center justify-center shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                    <Activity className="h-5 w-5 text-botkorp-orange" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">Quick Actions</h3>
                    <p className="text-xs text-muted-foreground/70 font-medium">
                      Common tasks
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="w-full justify-start h-10 text-xs font-semibold rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95"
                    onClick={() => navigate('/portal/services/add')}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Service
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start h-10 text-xs font-semibold rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95"
                    onClick={() => navigate('/admin/bot-management')}
                  >
                    <Bot className="h-4 w-4 mr-2" />
                    Manage Bots
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start h-10 text-xs font-semibold rounded-xl border-0 bg-gradient-to-br from-red-100 to-white dark:from-red-950 dark:to-slate-800 shadow-[4px_4px_12px_rgba(220,38,38,0.2),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(220,38,38,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(220,38,38,0.2),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(220,38,38,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] text-red-600 dark:text-red-400 transition-all duration-300 active:scale-95"
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Emergency Stop
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

