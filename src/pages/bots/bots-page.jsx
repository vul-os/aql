import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import LoadingLottie from '@/components/ui/loading-lottie';
import {
  Bot,
  Plus,
  Search,
  Activity,
  Battery,
  Wifi,
  WifiOff,
  MapPin,
  AlertTriangle,
  Settings as SettingsIcon,
  Play,
  Pause,
  Square,
  Thermometer,
  Droplets,
  ChevronRight,
  Eye
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import PageHeader from '@/components/ui/page-header';
import { formatDistanceToNow } from 'date-fns';

export default function BotsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { selectedOrg, locations: allLocations } = useAuth();
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('all');

  useEffect(() => {
    if (selectedOrg) {
      loadBots();
    }
  }, [selectedOrg, selectedLocation]);

  const loadBots = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('bots')
        .select(`
          *,
          location:locations(id, name, city, address),
          bot_garden_assignments(
            garden:gardens(id, name)
          )
        `)
        .order('created_at', { ascending: false });

      // Filter by location if not "all"
      if (selectedLocation !== 'all') {
        query = query.eq('location_id', selectedLocation);
      } else {
        // Get all bots for the organization's locations
        const locationIds = allLocations?.map(loc => loc.id) || [];
        if (locationIds.length > 0) {
          query = query.in('location_id', locationIds);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      // Flatten garden assignment
      const botsWithGarden = (data || []).map(bot => ({
        ...bot,
        assigned_garden: bot.bot_garden_assignments?.[0]?.garden || null
      }));

      setBots(botsWithGarden);
    } catch (error) {
      console.error('Error loading bots:', error);
      toast({
        title: "Error",
        description: "Failed to load bots",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredBots = bots.filter(bot =>
    bot.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    bot.serial_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    bot.bot_type?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusColor = (status) => {
    const colors = {
      online: 'bg-green-500',
      offline: 'bg-gray-500',
      active: 'bg-blue-500',
      idle: 'bg-yellow-500',
      charging: 'bg-purple-500',
      error: 'bg-red-500',
      maintenance: 'bg-orange-500'
    };
    return colors[status] || 'bg-gray-500';
  };

  const getStatusBadgeVariant = (status) => {
    if (status === 'online' || status === 'active') return 'default';
    if (status === 'error') return 'destructive';
    return 'secondary';
  };

  const getBotIcon = (botType) => {
    switch (botType) {
      case 'mow_bot':
        return <Bot className="h-6 w-6 text-green-600" />;
      case 'pool_bot':
        return <Bot className="h-6 w-6 text-blue-600" />;
      case 'weather_station':
        return <Activity className="h-6 w-6 text-purple-600" />;
      default:
        return <Bot className="h-6 w-6 text-gray-600" />;
    }
  };

  const getBotTypeName = (botType) => {
    switch (botType) {
      case 'mow_bot':
        return 'Mow Bot';
      case 'pool_bot':
        return 'Pool Bot';
      case 'weather_station':
        return 'Weather Station';
      default:
        return botType || 'Unknown';
    }
  };

  const handleViewBot = (botId) => {
    navigate(`/admin/bot/${botId}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <LoadingLottie
          src="https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie"
          message="Loading bots..."
          size="md"
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="Bots"
        subtitle={`Monitor and manage your ${bots.length} bot${bots.length !== 1 ? 's' : ''} across all locations`}
        icon={<Bot className="h-6 w-6 text-primary" />}
      />

      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="flex flex-col sm:flex-row gap-4 flex-1 w-full">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search bots by name, serial, or type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          {allLocations && allLocations.length > 0 && (
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {allLocations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      <span>{location.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Bots Grid */}
      {filteredBots.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="pt-6 pb-8 text-center">
            <Bot className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">
              {searchQuery ? 'No bots found' : 'No bots yet'}
            </h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              {searchQuery 
                ? 'Try adjusting your search terms or location filter'
                : 'Bots will appear here once they are assigned to your locations'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Quick Stats */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Bots</CardTitle>
                <Bot className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{bots.length}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  All bot types
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Online</CardTitle>
                <Wifi className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">
                  {bots.filter(b => b.status === 'online' || b.status === 'active').length}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Active and connected
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Offline</CardTitle>
                <WifiOff className="h-4 w-4 text-gray-600" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-gray-600">
                  {bots.filter(b => b.status === 'offline' || !b.status).length}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Not connected
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Issues</CardTitle>
                <AlertTriangle className="h-4 w-4 text-red-600" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-red-600">
                  {bots.filter(b => b.status === 'error' || b.status === 'maintenance').length}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Needs attention
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Bots List */}
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {filteredBots.map((bot) => (
              <Card 
                key={bot.id} 
                className="hover:shadow-lg transition-all duration-200 cursor-pointer group"
                onClick={() => handleViewBot(bot.id)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-lg group-hover:scale-110 transition-transform">
                        {getBotIcon(bot.bot_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg mb-1 truncate group-hover:text-botkorp-orange transition-colors">
                          {bot.name}
                        </CardTitle>
                        <CardDescription className="text-sm">
                          {getBotTypeName(bot.bot_type)}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${getStatusColor(bot.status)} animate-pulse`} />
                      <Badge variant={getStatusBadgeVariant(bot.status)} className="text-xs">
                        {bot.status || 'offline'}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Location Info */}
                  {bot.location && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      <span className="truncate">{bot.location.name}</span>
                    </div>
                  )}

                  {/* Bot Info */}
                  <div className="space-y-2 text-sm">
                    {bot.serial_number && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Serial:</span>
                        <span className="font-mono text-xs">{bot.serial_number}</span>
                      </div>
                    )}
                    {bot.assigned_garden && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Assigned to:</span>
                        <span className="truncate ml-2">{bot.assigned_garden.name}</span>
                      </div>
                    )}
                    {bot.last_seen && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last Seen:</span>
                        <span>{formatDistanceToNow(new Date(bot.last_seen), { addSuffix: true })}</span>
                      </div>
                    )}
                  </div>

                  {/* Stats Row */}
                  {(bot.battery_level !== null || bot.temperature !== null) && (
                    <div className="flex gap-4 pt-2 border-t">
                      {bot.battery_level !== null && (
                        <div className="flex items-center gap-1.5">
                          <Battery className={`h-4 w-4 ${bot.battery_level > 60 ? 'text-green-600' : bot.battery_level > 30 ? 'text-yellow-600' : 'text-red-600'}`} />
                          <span className="text-sm font-medium">{bot.battery_level}%</span>
                        </div>
                      )}
                      {bot.temperature !== null && (
                        <div className="flex items-center gap-1.5">
                          <Thermometer className="h-4 w-4 text-blue-600" />
                          <span className="text-sm font-medium">{bot.temperature}°C</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewBot(bot.id);
                      }}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View Details
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (bot.location) {
                          navigate(`/portal/location/${bot.location.id}/bot-status`);
                        }
                      }}
                    >
                      <MapPin className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

