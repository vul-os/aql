import React from 'react'

const PageHeader = ({ title, subtitle, icon = null, actions = null }) => {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {icon && (
            <div className="group relative">
              {/* Soft glow background layer */}
              <div className="absolute -inset-1 bg-gradient-to-r from-botkorp-orange/20 to-accent/10 rounded-3xl blur-lg group-hover:blur-xl opacity-60 group-hover:opacity-100 transition-all duration-500 animate-pulse-glow" />
              
              {/* Main icon container with neumorphic design */}
              <div className="relative h-14 w-14 rounded-3xl bg-gradient-to-br from-background via-card to-background flex items-center justify-center shadow-[0_8px_32px_rgba(255,107,53,0.15),0_2px_8px_rgba(0,0,0,0.05),inset_0_1px_2px_rgba(255,255,255,0.1)] border border-border/40 backdrop-blur-sm group-hover:scale-105 group-hover:shadow-[0_12px_40px_rgba(255,107,53,0.25),0_4px_12px_rgba(0,0,0,0.08),inset_0_2px_4px_rgba(255,255,255,0.15)] transition-all duration-300 overflow-hidden">
                {/* Animated shimmer overlay */}
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                
                {/* Inner gradient accent */}
                <div className="absolute inset-2 rounded-2xl bg-gradient-to-br from-botkorp-orange/10 to-accent/5 opacity-50" />
                
                {/* Icon */}
                <div className="relative z-10">
                  {React.cloneElement(icon, { 
                    className: "h-6 w-6 text-botkorp-orange drop-shadow-[0_2px_4px_rgba(255,107,53,0.3)] group-hover:text-accent transition-colors duration-300" 
                  })}
                </div>
              </div>
            </div>
          )}
          
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Title with soft gradient and enhanced typography */}
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground via-foreground/95 to-foreground/90 bg-clip-text text-transparent animate-in fade-in duration-500 leading-tight">
              {title}
            </h1>
            
            {subtitle && (
              <p className="text-sm text-muted-foreground/80 leading-relaxed max-w-2xl animate-in fade-in duration-700 font-medium">
                {subtitle}
              </p>
            )}
            
            {/* Subtle decorative underline */}
            <div className="flex items-center gap-2 pt-1">
              <div className="h-0.5 w-12 bg-gradient-to-r from-botkorp-orange via-accent/50 to-transparent rounded-full shadow-[0_0_8px_rgba(255,107,53,0.4)]" />
              <div className="h-0.5 w-6 bg-gradient-to-r from-botkorp-orange/50 to-transparent rounded-full" />
            </div>
          </div>
        </div>

        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0 animate-in slide-in-from-right-5 duration-500">
            {actions}
          </div>
        )}
      </div>
      
      {/* Bottom decorative gradient bar - soft ui accent */}
      <div className="mt-6 h-px bg-gradient-to-r from-transparent via-border/50 to-transparent shadow-[0_1px_3px_rgba(0,0,0,0.03)]" />
    </div>
  )
}

export default PageHeader


