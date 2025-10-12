import React, { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Bot,
  Sprout,
  Droplets,
  AlertTriangle,
  Calendar,
  Activity,
  TrendingUp,
  MapPin
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
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

export default function DashboardPage() {
  const { selectedOrg } = useOutletContext();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState(null);
  const [botStatusData, setBotStatusData] = useState([]);
  const [botTypeData, setBotTypeData] = useState([]);
  const [mowingActivity, setMowingActivity] = useState([]);
  const [upcomingServices, setUpcomingServices] = useState([]);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6'];

  useEffect(() => {
    if (selectedOrg) {
      loadDashboardData();
    }
  }, [selectedOrg]);

  const loadDashboardData = async () => {
    if (!selectedOrg?.organization_id) return;

    try {
      setLoading(true);

      // Load main analytics
      const { data: analyticsData, error: analyticsError } = await supabase.rpc(
        'get_organization_dashboard_analytics',
        { org_id: selectedOrg.organization_id }
      );

      if (analyticsError) throw analyticsError;
      setAnalytics(analyticsData);

      // Load bot status distribution
      const { data: statusData, error: statusError } = await supabase.rpc(
        'get_bot_status_distribution',
        { org_id: selectedOrg.organization_id }
      );

      if (statusError) throw statusError;
      setBotStatusData(statusData || []);

      // Load bot type distribution
      const { data: typeData, error: typeError } = await supabase.rpc(
        'get_bot_type_distribution',
        { org_id: selectedOrg.organization_id }
      );

      if (typeError) throw typeError;
      setBotTypeData(typeData || []);

      // Load mowing activity
      const { data: mowingData, error: mowingError } = await supabase.rpc(
        'get_mowing_activity_last_30_days',
        { org_id: selectedOrg.organization_id }
      );

      if (mowingError) throw mowingError;
      setMowingActivity((mowingData || []).reverse());

      // Load upcoming services
      const { data: servicesData, error: servicesError } = await supabase.rpc(
        'get_upcoming_services',
        { org_id: selectedOrg.organization_id, days_ahead: 30 }
      );

      if (servicesError) throw servicesError;
      setUpcomingServices(servicesData || []);

      // Load recent alerts
      const { data: alertsData, error: alertsError } = await supabase.rpc(
        'get_recent_alerts',
        { org_id: selectedOrg.organization_id, limit_count: 5 }
      );

      if (alertsError) throw alertsError;
      setRecentAlerts(alertsData || []);

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

  const StatCard = ({ title, value, icon, description, trend }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
        {trend && (
          <div className="flex items-center text-xs text-muted-foreground mt-1">
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

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your Bot Korp operations
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
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
          description={`${analytics?.total_area_managed_sqm || 0} m² managed`}
        />
        <StatCard
          title="Total Pools"
          value={analytics?.total_pools || 0}
          icon={<Droplets className="h-4 w-4 text-muted-foreground" />}
          description={`${analytics?.pools_needing_maintenance || 0} need maintenance`}
        />
        <StatCard
          title="Next Service"
          value={analytics?.upcoming_services_count || 0}
          icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
          description={
            analytics?.next_service_date
              ? `${format(new Date(analytics.next_service_date), 'MMM d')}`
              : 'No upcoming services'
          }
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
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
        <StatCard
          title="Unread Alerts"
          value={analytics?.unread_alerts_count || 0}
          icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
          description={`${analytics?.critical_alerts_count || 0} critical`}
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
                  <Bar dataKey="count" fill="#10b981" />
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
                  stroke="#10b981" 
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
    </div>
  );
}

