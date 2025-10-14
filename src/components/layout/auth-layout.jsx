import React from 'react'

export default function AuthLayout({ children, title, subtitle, imageUrl = '/images/lawn.webp' }) {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* Left: Form */}
      <div className="relative flex items-center justify-center p-4 sm:p-8">
        <div className="absolute inset-0 lg:hidden bg-[url('/images/lawn.webp')] bg-cover bg-center" />
        <div className="absolute inset-0 lg:hidden bg-black/50" />
        <div className="relative z-10 w-full max-w-md">
          {title || subtitle ? (
            <div className="mb-6 text-center lg:text-left">
              {title ? <h1 className="text-2xl font-bold mb-1">{title}</h1> : null}
              {subtitle ? <p className="text-muted-foreground">{subtitle}</p> : null}
            </div>
          ) : null}
          {children}
        </div>
      </div>

      {/* Right: Image */}
      <div className="hidden lg:block relative">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('${imageUrl}')` }}
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-black/40 to-black/10" />
      </div>
    </div>
  )
}


