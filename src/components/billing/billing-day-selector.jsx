import React from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from 'lucide-react';

export default function BillingDaySelector({ value, onChange, className }) {
  const getOrdinalSuffix = (day) => {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };

  return (
    <div className={`space-y-2 ${className || ''}`}>
      <Label htmlFor="billing-day" className="flex items-center gap-2">
        <Calendar className="h-4 w-4" />
        Preferred Billing Day
      </Label>
      <Select 
        value={value?.toString()} 
        onValueChange={(val) => onChange(parseInt(val))}
      >
        <SelectTrigger id="billing-day">
          <SelectValue placeholder="Select billing day" />
        </SelectTrigger>
        <SelectContent className="max-h-[300px]">
          {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
            <SelectItem key={day} value={day.toString()}>
              {day}{getOrdinalSuffix(day)} of each month
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Choose when you'd like to be billed each month (limited to days 1-28 to ensure consistent billing)
      </p>
      {value && (
        <p className="text-xs text-green-600">
          Your first invoice will be prorated if you start mid-month
        </p>
      )}
    </div>
  );
}

