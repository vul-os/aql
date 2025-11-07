import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Calendar, 
  Clock,
  MapPin,
  Sprout,
  Droplets,
  Shield,
  ArrowRight
} from 'lucide-react';

/**
 * Upcoming Schedule Widget
 * Shows next scheduled services for peace of mind
 */
export default function UpcomingScheduleWidget({ 
  upcomingServices = [],
  onViewAll 
}) {
  const serviceIcons = {
    lawn_care: Sprout,
    pool_maintenance: Droplets,
    security: Shield,
    default: Calendar
  };

  const serviceColors = {
    lawn_care: {
      iconBg: 'bg-green-500/10',
      iconColor: 'text-green-600',
      badgeClass: 'bg-green-500/10 text-green-700 dark:text-green-400 border-0'
    },
    pool_maintenance: {
      iconBg: 'bg-blue-500/10',
      iconColor: 'text-blue-600',
      badgeClass: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-0'
    },
    security: {
      iconBg: 'bg-botkorp-orange/10',
      iconColor: 'text-botkorp-orange',
      badgeClass: 'bg-botkorp-orange/10 text-botkorp-orange border-0'
    },
    default: {
      iconBg: 'bg-slate-500/10',
      iconColor: 'text-slate-600',
      badgeClass: 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-0'
    }
  };

  const formatTime = (dateTime) => {
    const date = new Date(dateTime);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatDate = (dateTime) => {
    const date = new Date(dateTime);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      });
    }
  };

  // Empty state
  if (!upcomingServices || upcomingServices.length === 0) {
    return (
      <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 rounded-3xl">
        <CardContent className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-500/10 dark:from-purple-500/30 dark:to-purple-500/20 flex items-center justify-center shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
              <Calendar className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Upcoming</h3>
              <p className="text-xs text-muted-foreground/70 font-medium">
                Next services
              </p>
            </div>
          </div>
          <div className="text-center py-6">
            <Calendar className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground/60 font-medium">
              No upcoming services scheduled
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 rounded-3xl">
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-500/10 dark:from-purple-500/30 dark:to-purple-500/20 flex items-center justify-center shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
            <Calendar className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Upcoming</h3>
            <p className="text-xs text-muted-foreground/70 font-medium">
              Next {upcomingServices.length} {upcomingServices.length === 1 ? 'service' : 'services'}
            </p>
          </div>
        </div>

        {/* Services List */}
        <div className="space-y-2.5">
          {upcomingServices.slice(0, 3).map((service, idx) => {
            const serviceType = service.service_type || 'default';
            const ServiceIcon = serviceIcons[serviceType] || serviceIcons.default;
            const colors = serviceColors[serviceType] || serviceColors.default;

            return (
              <div
                key={service.id || idx}
                className="group p-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgb(147,51,234,0.15)] transition-all duration-300 cursor-pointer active:scale-98"
              >
                <div className="flex items-start gap-3">
                  <div className={`h-8 w-8 rounded-lg ${colors.iconBg} flex items-center justify-center flex-shrink-0`}>
                    <ServiceIcon className={`h-4 w-4 ${colors.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold text-foreground/90 line-clamp-1">
                        {service.service_name || service.location_name}
                      </p>
                      <Badge className={`${colors.badgeClass} text-[10px] px-1.5 py-0 h-5 flex-shrink-0`}>
                        {formatDate(service.scheduled_time)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground/70 font-medium">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTime(service.scheduled_time)}
                      </span>
                      {service.location_name && (
                        <span className="flex items-center gap-1 line-clamp-1">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          {service.location_name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* View All Button */}
        {upcomingServices.length > 3 && onViewAll && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-3 text-xs font-semibold text-purple-600 hover:text-purple-600 hover:bg-purple-500/10"
            onClick={onViewAll}
          >
            View all services
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

