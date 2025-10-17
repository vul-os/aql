import React from 'react'

const PageHeader = ({ title, subtitle, icon = null, actions = null }) => {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-white/70 to-accent/10 dark:from-secondary dark:via-secondary/40 dark:to-muted/40 p-4 md:p-6 shadow-md">
      {/* Decorative background elements */}
      <div className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/20 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-accent/20 blur-2xl" />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {icon ? (
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/70 dark:bg-white/10 shadow-sm border">
              {icon}
            </div>
          ) : null}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{title}</h1>
            {subtitle ? (
              <p className="text-sm md:text-base text-muted-foreground mt-1">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>

        {actions ? (
          <div className="flex items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default PageHeader


