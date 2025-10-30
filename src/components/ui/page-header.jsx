import React from 'react'

const PageHeader = ({ title, subtitle, icon = null, actions = null }) => {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white mb-0.5 animate-in fade-in slide-in-from-bottom-3 duration-700">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-700 delay-75">
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0 animate-in fade-in slide-in-from-right-5 duration-700 delay-150">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

export default PageHeader


