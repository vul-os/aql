import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, Clock, Info, AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' }
];

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

// Generate time slots from 10am to 4pm in 30-minute intervals
const generateTimeSlots = () => {
  const slots = [];
  for (let hour = 10; hour <= 16; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      if (hour === 16 && minute > 0) break; // Stop at 4:00pm
      const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const label = new Date(`2000-01-01T${time}`).toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      slots.push({ value: time, label });
    }
  }
  return slots;
};

const TIME_SLOTS = generateTimeSlots();

/**
 * ScheduleSelector Component
 * 
 * A flexible scheduling component that allows users to:
 * - Choose between weekly, monthly, or mixed scheduling
 * - Select specific days of the week
 * - Select specific days of the month
 * - Choose preferred time between 10am and 4pm
 * - Respects tier limits (max services per month)
 * - Shows pricing impact based on service frequency
 * 
 * @param {Object} props
 * @param {Object} props.schedule - Current schedule data
 * @param {Function} props.onChange - Callback when schedule changes
 * @param {number} props.maxServicesPerMonth - Max services allowed (from tier)
 * @param {string} props.className - Additional CSS classes
 * @param {number} props.basePrice - Base monthly price
 */
export default function ScheduleSelector({ 
  schedule = {
    scheduleType: 'weekly',
    weeklyDays: [],
    monthlyDays: [],
    preferredTime: '10:00'
  },
  onChange,
  maxServicesPerMonth = 4,
  basePrice = 0,
  className
}) {
  const [scheduleType, setScheduleType] = useState(schedule.scheduleType || 'weekly');
  const [weeklyDays, setWeeklyDays] = useState(schedule.weeklyDays || []);
  const [monthlyDays, setMonthlyDays] = useState(schedule.monthlyDays || []);
  const [preferredTime, setPreferredTime] = useState(schedule.preferredTime || '10:00');

  // Calculate total selected days per month
  const calculateMonthlyServices = () => {
    if (scheduleType === 'weekly') {
      // Approximate: days per week * 4.33 weeks per month
      return Math.floor(weeklyDays.length * 4.33);
    } else if (scheduleType === 'monthly') {
      return monthlyDays.length;
    } else if (scheduleType === 'mixed') {
      // For mixed, count unique days (approximate)
      const weeklyCount = Math.floor(weeklyDays.length * 4.33);
      return weeklyCount + monthlyDays.length;
    }
    return 0;
  };

  const estimatedServices = calculateMonthlyServices();
  const MAX_SERVICES_PER_MONTH = 8; // Hard limit
  const isOverLimit = estimatedServices > MAX_SERVICES_PER_MONTH;

  // Flexible pricing tiers - cost per service decreases with more services
  // Maximum 8 services per month (twice per week)
  const getPricingForServices = (serviceCount) => {
    if (serviceCount === 0) return null;
    
    // Pricing tiers - more services = better value per service (1-8 services max)
    const pricingTiers = [
      { min: 1, max: 1, pricePerService: 350, tierName: 'Pay-As-You-Go' },
      { min: 2, max: 3, pricePerService: 250, tierName: 'Light' },
      { min: 4, max: 4, pricePerService: 224.75, tierName: 'Standard (Weekly)', basePrice: 899 },
      { min: 5, max: 7, pricePerService: 210, tierName: 'Value' },
      { min: 8, max: 8, pricePerService: 196.88, tierName: 'Premium (2x Weekly)', basePrice: 1575 }
    ];
    
    // Limit to 8 services max
    const limitedServiceCount = Math.min(serviceCount, 8);
    
    // Find applicable tier
    const tier = pricingTiers.find(t => limitedServiceCount >= t.min && limitedServiceCount <= t.max) 
                 || pricingTiers[pricingTiers.length - 1]; // Default to highest tier
    
    const totalPrice = tier.basePrice || (tier.pricePerService * limitedServiceCount);
    const savingsVsPayAsYouGo = (350 - tier.pricePerService) * limitedServiceCount;
    
    return {
      totalPrice: Math.round(totalPrice * 100) / 100,
      pricePerService: tier.pricePerService,
      tierName: tier.tierName,
      selectedServices: limitedServiceCount,
      savingsVsPayAsYouGo: savingsVsPayAsYouGo > 0 ? savingsVsPayAsYouGo : 0,
      allTiers: pricingTiers,
      isOverLimit: serviceCount > 8
    };
  };

  const pricing = getPricingForServices(estimatedServices);

  // Notify parent of changes
  useEffect(() => {
    if (onChange) {
      onChange({
        scheduleType,
        weeklyDays,
        monthlyDays,
        preferredTime,
        estimatedServices,
        isValid: !isOverLimit && (
          (scheduleType === 'weekly' && weeklyDays.length > 0) ||
          (scheduleType === 'monthly' && monthlyDays.length > 0)
        )
      });
    }
  }, [scheduleType, weeklyDays, monthlyDays, preferredTime]);

  const handleScheduleTypeChange = (type) => {
    setScheduleType(type);
    // Reset selections when changing type
    if (type === 'weekly') {
      setMonthlyDays([]);
    } else if (type === 'monthly') {
      setWeeklyDays([]);
    }
  };

  // Quick select presets for common schedules
  const applyPreset = (preset) => {
    if (preset === 'weekly-2x') {
      setScheduleType('weekly');
      setWeeklyDays([1, 4]); // Monday & Thursday
    } else if (preset === 'weekly-1x') {
      setScheduleType('weekly');
      setWeeklyDays([3]); // Wednesday
    } else if (preset === 'monthly-2x') {
      setScheduleType('monthly');
      setMonthlyDays([1, 15]); // 1st & 15th
    }
  };

  const toggleWeeklyDay = (day) => {
    setWeeklyDays(prev => 
      prev.includes(day) 
        ? prev.filter(d => d !== day)
        : [...prev, day].sort((a, b) => a - b)
    );
  };

  const toggleMonthlyDay = (day) => {
    setMonthlyDays(prev => 
      prev.includes(day) 
        ? prev.filter(d => d !== day)
        : [...prev, day].sort((a, b) => a - b)
    );
  };

  const getScheduleSummary = () => {
    const parts = [];
    
    if (scheduleType === 'weekly' || scheduleType === 'mixed') {
      if (weeklyDays.length > 0) {
        const dayNames = weeklyDays
          .map(d => DAYS_OF_WEEK.find(day => day.value === d)?.short)
          .join(', ');
        parts.push(`Every ${dayNames}`);
      }
    }
    
    if (scheduleType === 'monthly' || scheduleType === 'mixed') {
      if (monthlyDays.length > 0) {
        const ordinal = (n) => {
          const s = ['th', 'st', 'nd', 'rd'];
          const v = n % 100;
          return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };
        const dayList = monthlyDays.map(d => ordinal(d)).join(', ');
        parts.push(`On the ${dayList} of each month`);
      }
    }
    
    if (parts.length === 0) return 'No schedule selected';
    
    const timeLabel = TIME_SLOTS.find(t => t.value === preferredTime)?.label || preferredTime;
    return `${parts.join(' and ')} at ${timeLabel}`;
  };

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Service Schedule
        </CardTitle>
        <CardDescription>
          Choose when you'd like your service visits. Your plan allows up to {maxServicesPerMonth} services per month.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        {/* Quick Presets */}
        <div className="space-y-3">
          <Label>Quick Select (Popular Schedules)</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset('weekly-1x')}
              className="text-xs"
            >
              Once Weekly (Wed)
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset('weekly-2x')}
              className="text-xs"
            >
              Twice Weekly (Mon & Thu)
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset('monthly-2x')}
              className="text-xs"
            >
              Twice Monthly (1st & 15th)
            </Button>
          </div>
        </div>

        {/* Schedule Type Selector */}
        <div className="space-y-3">
          <Label>How often do you need service?</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              type="button"
              variant={scheduleType === 'weekly' ? 'default' : 'outline'}
              className="h-auto py-4 flex flex-col items-start gap-1"
              onClick={() => handleScheduleTypeChange('weekly')}
            >
              <span className="font-semibold">Recurring Weekly Days</span>
              <span className="text-xs opacity-80">E.g., Every Monday & Thursday</span>
            </Button>
            <Button
              type="button"
              variant={scheduleType === 'monthly' ? 'default' : 'outline'}
              className="h-auto py-4 flex flex-col items-start gap-1"
              onClick={() => handleScheduleTypeChange('monthly')}
            >
              <span className="font-semibold">Specific Dates Each Month</span>
              <span className="text-xs opacity-80">E.g., 1st, 15th, 30th of each month</span>
            </Button>
          </div>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Choose the schedule that works best for your lawn. Weekly schedules repeat the same days every week. 
              Monthly schedules occur on specific dates each month.
            </AlertDescription>
          </Alert>
        </div>

        {/* Weekly Days Selection */}
        {scheduleType === 'weekly' && (
          <div className="space-y-3">
            <Label>Select Days of the Week</Label>
            <p className="text-xs text-muted-foreground">
              Your service will occur on these days every week
            </p>
            <div className="grid grid-cols-7 gap-2">
              {DAYS_OF_WEEK.map(day => (
                <Button
                  key={day.value}
                  type="button"
                  variant={weeklyDays.includes(day.value) ? 'default' : 'outline'}
                  className="h-14 flex flex-col items-center justify-center p-1"
                  onClick={() => toggleWeeklyDay(day.value)}
                >
                  <span className="text-xs font-semibold">{day.short}</span>
                </Button>
              ))}
            </div>
            {weeklyDays.length === 0 && (
              <Alert variant="default" className="bg-orange-50 border-orange-200">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription className="text-orange-800">
                  Select at least one day of the week for your service
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Monthly Days Selection */}
        {scheduleType === 'monthly' && (
          <div className="space-y-3">
            <Label>Select Dates of the Month</Label>
            <p className="text-xs text-muted-foreground">
              Your service will occur on these specific dates each month
            </p>
            <div className="grid grid-cols-7 sm:grid-cols-10 gap-2">
              {DAYS_OF_MONTH.map(day => (
                <Button
                  key={day}
                  type="button"
                  variant={monthlyDays.includes(day) ? 'default' : 'outline'}
                  className="h-10 w-10 p-0"
                  onClick={() => toggleMonthlyDay(day)}
                >
                  {day}
                </Button>
              ))}
            </div>
            {monthlyDays.length === 0 && (
              <Alert variant="default" className="bg-orange-50 border-orange-200">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription className="text-orange-800">
                  Select at least one date of the month for your service
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Time Selection */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Preferred Time
          </Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TIME_SLOTS.map(slot => (
              <Button
                key={slot.value}
                type="button"
                variant={preferredTime === slot.value ? 'default' : 'outline'}
                className="h-10"
                onClick={() => setPreferredTime(slot.value)}
              >
                {slot.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Schedule Summary */}
        <div className="space-y-3 pt-4 border-t">
          <Label>Schedule Summary</Label>
          <div className="bg-muted p-4 rounded-lg space-y-3">
            <p className="text-sm font-medium">{getScheduleSummary()}</p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Estimated services per month:
              </span>
              <Badge variant={isOverLimit ? 'destructive' : 'default'}>
                {estimatedServices} / {MAX_SERVICES_PER_MONTH} max
              </Badge>
            </div>

            {/* Pricing Impact */}
            {pricing && (
              <div className="pt-3 border-t space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Selected plan:</span>
                    <Badge variant="default">{pricing.tierName}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Services per month:</span>
                    <span className="font-semibold">{pricing.selectedServices}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Cost per service:</span>
                    <span className="text-muted-foreground">R{pricing.pricePerService.toFixed(2)}</span>
                  </div>
                </div>

                {pricing.savingsVsPayAsYouGo > 0 && (
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-800 text-xs">
                      <strong>Great value!</strong> You're saving R{pricing.savingsVsPayAsYouGo.toFixed(2)}/month compared to pay-as-you-go pricing (R350 per service).
                    </AlertDescription>
                  </Alert>
                )}

                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Your monthly total:</span>
                    <span className="text-2xl font-bold text-primary">
                      R{pricing.totalPrice.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {pricing.selectedServices} service{pricing.selectedServices > 1 ? 's' : ''} × R{pricing.pricePerService.toFixed(2)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Pricing Tiers Comparison */}
        {pricing && pricing.allTiers && (
          <div className="space-y-3">
            <Label>Popular Plans</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Show 3 most common tiers (1x, 4x, 8x) */}
              {[
                pricing.allTiers.find(t => t.min === 1), // Pay-as-you-go (1x)
                pricing.allTiers.find(t => t.min === 4), // Weekly (4x)
                pricing.allTiers.find(t => t.min === 8)  // 2x Weekly (8x) - MAX
              ].filter(Boolean).map((tier, idx) => {
                const tierTotal = tier.basePrice || (tier.pricePerService * tier.min);
                const isSelected = estimatedServices >= tier.min && estimatedServices <= tier.max;
                return (
                  <div 
                    key={idx}
                    className={cn(
                      "p-4 rounded-lg border transition-all cursor-pointer hover:border-primary",
                      isSelected ? "border-primary bg-primary/5 ring-2 ring-primary" : "border-muted"
                    )}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">
                          {tier.min}x/month
                        </Badge>
                        {isSelected && (
                          <Badge variant="default" className="text-xs">
                            Your Plan
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-semibold">{tier.tierName}</p>
                      <div>
                        <p className="text-2xl font-bold text-primary">
                          R{Math.round(tierTotal)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          R{tier.pricePerService.toFixed(2)} per service
                        </p>
                      </div>
                      {tier.min > 1 && (
                        <p className="text-xs text-green-600">
                          Save R{((350 - tier.pricePerService) * tier.min).toFixed(0)}/mo
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Flexible pricing:</strong> Choose any schedule - pricing automatically adjusts based on frequency. 
                More services = better value per visit!
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Warnings */}
        {isOverLimit && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Maximum limit exceeded!</strong> You've selected {estimatedServices} services, but the maximum is {MAX_SERVICES_PER_MONTH} per month (twice per week). 
              Please reduce your selected days.
            </AlertDescription>
          </Alert>
        )}

        {scheduleType === 'weekly' && weeklyDays.length === 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Please select at least one day of the week for your service schedule.
            </AlertDescription>
          </Alert>
        )}

        {scheduleType === 'monthly' && monthlyDays.length === 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Please select at least one day of the month for your service schedule.
            </AlertDescription>
          </Alert>
        )}

        {/* Info Box */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>Service Window:</strong> All services are scheduled between 10:00 AM and 4:00 PM. 
            You'll receive a notification 24 hours before each scheduled service.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

