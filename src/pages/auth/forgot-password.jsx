import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, CheckCircle, Mail, Lock } from 'lucide-react'
import { useAuth } from '@/context/auth-context'

const ForgotPassword = () => {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  
  const { resetPassword } = useAuth()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { data, error } = await resetPassword(email)
      
      if (error) {
        setError(error.message)
      } else {
        setSuccess(true)
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-50/50 to-white">
        <div className="w-full max-w-md">
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-slate-200/50 shadow-2xl shadow-slate-200/50 p-12 text-center space-y-6">
            <div className="flex justify-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                <Mail className="w-10 h-10 text-white" strokeWidth={2.5} />
              </div>
            </div>
            
            <div className="space-y-2">
              <h2 className="text-3xl font-bold text-slate-900">Check Your Email</h2>
              <p className="text-slate-600">
                We've sent a password reset link to
              </p>
              <p className="text-[#FF6B35] font-semibold">{email}</p>
              <p className="text-sm text-slate-600 pt-2">
                Click the link in the email to reset your password. The link will expire in 1 hour.
              </p>
            </div>
            
            <Link to="/auth/login" className="block pt-2">
              <Button className="w-full py-3 bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] hover:from-[#E85A2A] hover:to-[#FF6B35] text-white font-semibold rounded-xl shadow-lg shadow-[#FF6B35]/25 hover:shadow-xl hover:shadow-[#FF6B35]/30 transition-all duration-200">
                <ArrowLeft className="mr-2 h-5 w-5" />
                Back to Sign In
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-50/50 to-white">
      {/* Split Layout Container */}
      <div className="flex flex-col lg:flex-row w-full">
        {/* Left Side - Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md">
            {/* Logo/Brand */}
            <div className="mb-8">
              <div className="inline-flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#FF6B35] to-[#E85A2A] flex items-center justify-center shadow-lg shadow-[#FF6B35]/20">
                  <Lock className="w-6 h-6 text-white" strokeWidth={2.5} />
                </div>
                <span className="text-2xl font-bold text-slate-900">Bot Korp</span>
              </div>
            </div>

            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl lg:text-4xl font-bold mb-3 text-slate-900">
                Reset Password
              </h1>
              <p className="text-slate-600 text-base">Enter your email to receive a reset link</p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <Alert variant="destructive" className="border-red-200 bg-red-50/80 rounded-xl">
                  <AlertDescription className="text-red-700 text-sm">{error}</AlertDescription>
                </Alert>
              )}
              
              {/* Email Field */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-slate-700">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                    className="w-full pl-12 pr-4 py-3 border-slate-200 bg-white/80 rounded-xl text-slate-900 placeholder:text-slate-400 focus:border-[#FF6B35] focus:ring-2 focus:ring-[#FF6B35]/10 transition-all"
                  />
                </div>
              </div>
              
              {/* Submit Button */}
              <Button 
                type="submit" 
                className="w-full py-3.5 bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] hover:from-[#E85A2A] hover:to-[#FF6B35] text-white font-semibold rounded-xl shadow-lg shadow-[#FF6B35]/25 hover:shadow-xl hover:shadow-[#FF6B35]/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed" 
                disabled={loading}
              >
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Sending...</span>
                  </div>
                ) : (
                  'Send Reset Link'
                )}
              </Button>
            </form>
            
            {/* Back Link */}
            <div className="mt-8 text-center">
              <Link 
                to="/auth/login" 
                className="text-sm text-slate-600 hover:text-[#FF6B35] inline-flex items-center gap-2 transition-colors font-medium"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Sign In</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Right Side - Image */}
        <div className="hidden lg:flex flex-1 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#FF6B35]/10 via-transparent to-[#E85A2A]/10 z-10" />
          <img 
            src="/images/lawn.webp" 
            alt="Lawn Care" 
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20 z-20" />
          <div className="absolute bottom-12 left-12 right-12 z-30 text-white">
            <h2 className="text-3xl font-bold mb-3">We've Got You Covered</h2>
            <p className="text-lg text-white/90">Don't worry, getting back to your lawn care dashboard is just a few clicks away.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ForgotPassword
