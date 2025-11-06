import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Bot, 
  MapPin, 
  Clock, 
  Battery, 
  MoreVertical,
  Pause,
  Square,
  Eye,
  Sprout,
  Droplets,
  Shield,
  Activity
} from 'lucide-react';
import { formatDuration, intervalToDuration } from 'date-fns';

/**
 * Live Service Card Component
 * Shows real-time service progress with actions
 */
export function LiveServiceCard({ service, onPause, onStop, onView }) {
  const getServiceIcon = (type) => {
    const icons = {
      lawn_mowing: Sprout,
      pool_cleaning: Droplets,
      security: Shield
    };
    return icons[type] || Bot;
  };

  const getServiceColor = (type) => {
    const colors = {
      lawn_mowing: 'green',
      pool_cleaning: 'blue',
      security: 'orange'
    };
    return colors[type] || 'gray';
  };

  const ServiceIcon = getServiceIcon(service.service_type);
  const color = getServiceColor(service.service_type);
  
  // Calculate runtime duration
  const duration = service.started_at 
    ? intervalToDuration({
        start: new Date(service.started_at),
        end: new Date()
      })
    : null;
  
  const durationString = duration 
    ? formatDuration(duration, { format: ['hours', 'minutes'] })
    : 'Unknown';

  // Calculate ETA
  const getETA = () => {
    if (!service.estimated_completion_time) return 'Unknown';
    const eta = intervalToDuration({
      start: new Date(),
      end: new Date(service.estimated_completion_time)
    });
    return formatDuration(eta, { format: ['hours', 'minutes'] }) || '< 1 min';
  };

  return (
    <Card className={`border-l-4 border-l-${color}-500 shadow-sm hover:shadow-md transition-all duration-300 bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30`}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
            <Badge variant="outline" className="text-xs px-2 py-0">
              LIVE
            </Badge>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onView && (
                <DropdownMenuItem onClick={() => onView(service)}>
                  <Eye className="h-4 w-4 mr-2" />
                  View Live
                </DropdownMenuItem>
              )}
              {onPause && (
                <DropdownMenuItem onClick={() => onPause(service)}>
                  <Pause className="h-4 w-4 mr-2" />
                  Pause Service
                </DropdownMenuItem>
              )}
              {onStop && (
                <DropdownMenuItem 
                  onClick={() => onStop(service)}
                  className="text-red-600"
                >
                  <Square className="h-4 w-4 mr-2" />
                  Stop Service
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Service Info */}
        <div className="flex items-start gap-3 mb-4">
          <div className={`h-12 w-12 rounded-xl bg-${color}-50 dark:bg-${color}-900/20 flex items-center justify-center flex-shrink-0`}>
            <ServiceIcon className={`h-6 w-6 text-${color}-600`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm mb-1 truncate">
              {service.service_name || service.service_type}
            </h3>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Bot className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{service.bot_name || 'Unknown Bot'}</span>
              </div>
              <div className="flex items-center gap-1">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{service.location_name || 'Unknown Location'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-semibold">
              {service.progress_percentage || 0}% • {service.area_covered_sqm || 0} / {service.total_area_sqm || 0} m²
            </span>
          </div>
          <Progress value={service.progress_percentage || 0} className="h-2" />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="flex flex-col">
            <span className="text-muted-foreground mb-1">Runtime</span>
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-blue-600" />
              <span className="font-semibold">{durationString || '< 1 min'}</span>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground mb-1">Battery</span>
            <div className="flex items-center gap-1">
              <Battery className={`h-3 w-3 ${(service.battery_percentage || 0) > 20 ? 'text-green-600' : 'text-red-600'}`} />
              <span className={`font-semibold ${(service.battery_percentage || 0) > 20 ? 'text-green-600' : 'text-red-600'}`}>
                {service.battery_percentage || 0}%
              </span>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground mb-1">ETA</span>
            <span className="font-semibold">{getETA()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Live Services List Component
 * Container for multiple live service cards
 */
export function LiveServicesList({ services = [], onPause, onStop, onView }) {
  if (services.length === 0) {
    return null;
  }

  return (
    <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
      <CardContent className="p-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-green-500/15 to-green-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(34,197,94,0.15)]">
            <Activity className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <h3 className="text-base font-bold">Live Services</h3>
            <p className="text-[11px] text-muted-foreground/70 font-medium">
              {services.length} service{services.length !== 1 ? 's' : ''} in progress
            </p>
          </div>
        </div>
        
        <div className="space-y-3">
          {services.map((service, idx) => (
            <div 
              key={service.service_id}
              className="animate-in fade-in slide-in-from-left-2"
              style={{ animationDelay: `${idx * 50}ms`, animationDuration: '300ms' }}
            >
              <LiveServiceCard
                service={service}
                onPause={onPause}
                onStop={onStop}
                onView={onView}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

