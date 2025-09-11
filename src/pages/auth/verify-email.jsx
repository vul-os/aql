import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Bot, CheckCircle, XCircle, Mail } from 'lucide-react'
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
            navigate('/dashboard')
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
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-green-600 mx-auto mb-4"></div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Verifying Email...</h2>
            <p className="text-gray-600">Please wait while we verify your email address</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Email Verified!</h2>
            <p className="text-gray-600 mb-4">
              Your email has been successfully verified. Redirecting to dashboard...
            </p>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto"></div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <Bot className="h-8 w-8 text-green-600" />
            <span className="text-2xl font-bold text-gray-900">Botserv</span>
          </div>
          <CardTitle>Email Verification</CardTitle>
          <CardDescription>
            We're verifying your email address
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <div className="space-y-4">
            <Mail className="h-16 w-16 text-gray-400 mx-auto" />
            <p className="text-gray-600">
              There was an issue verifying your email address. This could be because:
            </p>
            <ul className="text-sm text-gray-500 text-left space-y-1">
              <li>• The verification link has expired</li>
              <li>• The link has already been used</li>
              <li>• The link is invalid</li>
            </ul>
            <div className="pt-4">
              <Button 
                onClick={() => navigate('/auth/signin')}
                className="w-full"
              >
                Back to Sign In
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default VerifyEmail
