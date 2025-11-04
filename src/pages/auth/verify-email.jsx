import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle, XCircle, Mail, Zap, Shield } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const VerifyEmail = () => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    const verifyEmail = async () => {
      const token = searchParams.get('token')
      const type = searchParams.get('type')
      
      if (!token || type !== 'signup') {
        setError('Invalid verification link')
        setLoading(false)
        return
      }

      try {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: token,
          type: 'signup'
        })

        if (error) {
          setError(error.message)
        } else {
          setSuccess(true)
          // Redirect to dashboard after a short delay
          setTimeout(() => {
            navigate('/portal')
          }, 3000)
        }
      } catch (err) {
        setError('An unexpected error occurred')
      } finally {
        setLoading(false)
      }
    }

    verifyEmail()
  }, [searchParams, navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-50/50 to-white">
        <div className="w-full max-w-md">
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-slate-200/50 shadow-2xl shadow-slate-200/50 p-12 text-center space-y-6">
            <div className="flex justify-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                <Shield className="w-10 h-10 text-white" strokeWidth={2.5} />
              </div>
            </div>
            
            <div className="space-y-2">
              <h2 className="text-3xl font-bold text-slate-900">Verifying Email...</h2>
              <p className="text-slate-600">
                Please wait while we verify your email address
              </p>
            </div>
            
            <div className="flex items-center justify-center gap-3">
              <Zap className="w-5 h-5 text-[#FF6B35] animate-pulse" />
              <div className="w-5 h-5 border-2 border-[#FF6B35]/30 border-t-[#FF6B35] rounded-full animate-spin" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-50/50 to-white">
        <div className="w-full max-w-md">
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-slate-200/50 shadow-2xl shadow-slate-200/50 p-12 text-center space-y-6">
            <div className="flex justify-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg">
                <CheckCircle className="w-10 h-10 text-white" strokeWidth={2.5} />
              </div>
            </div>
            
            <div className="space-y-2">
              <h2 className="text-3xl font-bold text-slate-900">Email Verified!</h2>
              <p className="text-slate-600">
                Your email has been successfully verified. Redirecting to dashboard...
              </p>
            </div>
            
            <div className="flex items-center justify-center gap-3">
              <Zap className="w-5 h-5 text-[#FF6B35] animate-pulse" />
              <div className="w-5 h-5 border-2 border-[#FF6B35]/30 border-t-[#FF6B35] rounded-full animate-spin" />
            </div>
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
                  <XCircle className="w-6 h-6 text-white" strokeWidth={2.5} />
                </div>
                <span className="text-2xl font-bold text-slate-900">Bot Korp</span>
              </div>
            </div>

            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl lg:text-4xl font-bold mb-3 text-slate-900">
                Verification Failed
              </h1>
              <p className="text-slate-600 text-base">There was an issue verifying your email</p>
            </div>

            {/* Content */}
            {error && (
              <Alert variant="destructive" className="mb-6 border-red-200 bg-red-50/80 rounded-xl">
                <AlertDescription className="text-red-700 text-sm">{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-6">
              <div className="flex justify-center">
                <Mail className="h-16 w-16 text-slate-300" />
              </div>
              
              <p className="text-slate-600 text-center text-sm">
                This could be because:
              </p>
              
              <ul className="space-y-3 bg-slate-50/80 p-4 rounded-xl border border-slate-200">
                <li className="flex items-start gap-3 text-sm text-slate-600">
                  <span className="text-[#FF6B35] mt-0.5 text-lg">•</span>
                  <span>The verification link has expired</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-slate-600">
                  <span className="text-[#FF6B35] mt-0.5 text-lg">•</span>
                  <span>The link has already been used</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-slate-600">
                  <span className="text-[#FF6B35] mt-0.5 text-lg">•</span>
                  <span>The link is invalid or malformed</span>
                </li>
              </ul>
              
              <Link to="/auth/login" className="block">
                <Button className="w-full py-3.5 bg-gradient-to-r from-[#FF6B35] to-[#E85A2A] hover:from-[#E85A2A] hover:to-[#FF6B35] text-white font-semibold rounded-xl shadow-lg shadow-[#FF6B35]/25 hover:shadow-xl hover:shadow-[#FF6B35]/30 transition-all duration-200">
                  Back to Sign In
                </Button>
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
            <h2 className="text-3xl font-bold mb-3">Almost There!</h2>
            <p className="text-lg text-white/90">Verify your email to unlock the full potential of automated lawn care services.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default VerifyEmail
