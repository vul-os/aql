import React from 'react'

const PageHeader = ({ title, subtitle, icon = null, actions = null }) => {
  return (
    <div className="mb-8 relative overflow-hidden">
      {/* Animated background gradient */}
      <div className="absolute inset-0 bg-gradient-to-r from-botkorp-orange/5 via-accent/5 to-botkorp-slate-blue/5 dark:from-botkorp-orange/10 dark:via-accent/10 dark:to-botkorp-slate-blue/10 rounded-3xl" />
      
      {/* Animated orbs */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-botkorp-orange/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-accent/20 rounded-full blur-3xl animate-pulse delay-75" />
      
      <div className="relative p-8 rounded-3xl border-2 border-white/20 dark:border-white/10 backdrop-blur-sm bg-gradient-to-br from-white/40 to-white/20 dark:from-gray-900/40 dark:to-gray-800/20 shadow-xl hover:shadow-2xl transition-all duration-500">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-5 flex-1 min-w-0">
            {icon && (
              <div className="relative group">
                {/* Glow effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-botkorp-orange to-red-500 rounded-2xl blur-xl opacity-50 group-hover:opacity-75 transition-opacity duration-300" />
                <div className="relative flex-shrink-0 h-16 w-16 rounded-2xl bg-gradient-to-br from-botkorp-orange via-red-500 to-red-600 shadow-2xl shadow-botkorp-orange/50 flex items-center justify-center ring-4 ring-white/20 dark:ring-white/10 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
                  {React.cloneElement(icon, { className: 'h-8 w-8 text-white' })}
                </div>
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2">
              <h1 className="text-4xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 dark:from-white dark:via-gray-100 dark:to-white bg-clip-text text-transparent leading-tight animate-in fade-in slide-in-from-bottom-3 duration-700">
                {title}
              </h1>
              {subtitle && (
                <p className="text-base md:text-lg text-muted-foreground leading-relaxed max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {actions && (
            <div className="flex items-center gap-3 flex-shrink-0 animate-in fade-in slide-in-from-right-5 duration-700 delay-200">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default PageHeader


