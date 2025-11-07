import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Cloud, 
  CloudRain, 
  CloudSnow, 
  Sun, 
  CloudDrizzle,
  Wind,
  Droplets,
  Eye
} from 'lucide-react';

/**
 * Weather & Conditions Widget
 * Shows current weather and its impact on operations
 */
export default function WeatherConditionsWidget({ 
  temperature = 22,
  condition = 'clear', // clear, cloudy, rain, drizzle, snow
  humidity = 65,
  windSpeed = 12,
  visibility = 10,
  impact = 'optimal' // optimal, good, delayed, suspended
}) {
  const weatherIcons = {
    clear: Sun,
    cloudy: Cloud,
    rain: CloudRain,
    drizzle: CloudDrizzle,
    snow: CloudSnow
  };

  const impactConfig = {
    optimal: {
      badge: 'Optimal Conditions',
      badgeClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-0',
      description: 'Perfect for all operations'
    },
    good: {
      badge: 'Good Conditions',
      badgeClass: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-0',
      description: 'Operations running normally'
    },
    delayed: {
      badge: 'Delayed',
      badgeClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-0',
      description: 'Some services may be delayed'
    },
    suspended: {
      badge: 'Suspended',
      badgeClass: 'bg-red-500/10 text-red-700 dark:text-red-400 border-0',
      description: 'Operations temporarily paused'
    }
  };

  const WeatherIcon = weatherIcons[condition] || Sun;
  const impactInfo = impactConfig[impact] || impactConfig.optimal;

  return (
    <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 rounded-3xl">
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-500/10 dark:from-blue-500/30 dark:to-blue-500/20 flex items-center justify-center shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
            <WeatherIcon className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Weather</h3>
            <p className="text-xs text-muted-foreground/70 font-medium">
              Current conditions
            </p>
          </div>
        </div>

        {/* Temperature & Condition */}
        <div className="mb-4">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{temperature}°</span>
            <span className="text-sm text-muted-foreground/70 font-medium capitalize">{condition}</span>
          </div>
          <Badge className={`${impactInfo.badgeClass} text-[10px] px-2 py-1`}>
            {impactInfo.badge}
          </Badge>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center p-2 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
            <Droplets className="h-4 w-4 text-blue-500/70 mb-1" />
            <span className="text-xs font-bold tabular-nums">{humidity}%</span>
            <span className="text-[10px] text-muted-foreground/60 font-medium">Humidity</span>
          </div>
          <div className="flex flex-col items-center p-2 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
            <Wind className="h-4 w-4 text-slate-500/70 mb-1" />
            <span className="text-xs font-bold tabular-nums">{windSpeed}</span>
            <span className="text-[10px] text-muted-foreground/60 font-medium">km/h</span>
          </div>
          <div className="flex flex-col items-center p-2 rounded-lg bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
            <Eye className="h-4 w-4 text-purple-500/70 mb-1" />
            <span className="text-xs font-bold tabular-nums">{visibility}</span>
            <span className="text-[10px] text-muted-foreground/60 font-medium">km</span>
          </div>
        </div>

        {/* Impact Description */}
        <p className="text-xs text-muted-foreground/70 font-medium mt-3 text-center">
          {impactInfo.description}
        </p>
      </CardContent>
    </Card>
  );
}

