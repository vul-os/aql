import React from 'react';
import { cn } from '@/lib/utils';

export function GradientText({
  children,
  className,
  from = 'from-botkorp-orange',
  via = 'via-botkorp-orange-dark',
  to = 'to-botkorp-slate-blue',
  animate = false
}) {
  return (
    <span
      className={cn(
        'bg-gradient-to-r bg-clip-text text-transparent',
        from,
        via,
        to,
        animate && 'animate-shine bg-[length:200%_auto]',
        className
      )}
    >
      {children}
    </span>
  );
}

