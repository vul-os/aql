import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, CheckCircle, Mail } from 'lucide-react'
import { useAuth } from '@/context/auth-context'

const WireConnectorIcon = () => (
  <svg 
    width="64" 
    height="64" 
    viewBox="0 0 32 32" 
    xmlns="http://www.w3.org/2000/svg"
    className="text-accent"
  >
    <path 
      fill="currentColor" 
      d="M8.7539062 7.0019531C7.5518169 7.0189744 6.5156108 7.1541874 5.6542969 7.5253906C4.792983 7.8965938 4.0175781 8.7132065 4.0175781 9.7226562L4.0175781 13.767578C2.7678093 14.956517 1.9824219 16.629553 1.9824219 18.482422C1.9824219 22.070368 4.9120509 25 8.5 25C9.7488691 25 10.887382 24.622768 11.857422 24L21.810547 24C22.360487 24.605195 23.142302 25 24.017578 25C24.892682 25 25.674432 24.605984 26.224609 24L26.900391 24C28.591188 24 30.017578 22.648216 30.017578 20.960938L30.017578 18.900391C30.017578 16.271923 28.23932 14.076878 25.853516 12.353516C23.467711 10.630153 20.383804 9.2992382 17.302734 8.3828125C14.221665 7.4663868 11.158085 6.9679106 8.7539062 7.0019531 z M 8.78125 9.0019531C10.877071 8.9722771 13.813492 9.4306289 16.732422 10.298828C19.651352 11.167027 22.567445 12.447441 24.681641 13.974609C26.423003 15.232466 27.546099 16.602781 27.892578 18L14.919922 18C14.659128 14.647426 11.917139 11.964844 8.5 11.964844C7.621298 11.964844 6.7839481 12.142875 6.0175781 12.460938L6.0175781 9.7226562C6.0175781 9.5848561 5.9941261 9.5577304 6.4453125 9.3632812C6.8964986 9.1688322 7.7333395 9.0167912 8.78125 9.0019531 z M 8.5 13.964844C11.00707 13.964844 13.017578 15.975354 13.017578 18.482422C13.017578 20.98949 11.00707 23 8.5 23C5.9929305 23 3.9824219 20.98949 3.9824219 18.482422C3.9824219 15.975354 5.9929305 13.964844 8.5 13.964844 z M 8.5 17.482422 A 1 1 0 0 0 8.5 19.482422 A 1 1 0 0 0 8.5 17.482422 z M 14.708984 20L28.017578 20L28.017578 20.960938C28.017578 21.525659 27.549593 22 26.900391 22L13.855469 22C14.239278 21.392294 14.530946 20.71866 14.708984 20 z"
    />
  </svg>
)

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
      <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="wire-grid-forgot" width="100" height="100" patternUnits="userSpaceOnUse">
                <path d="M 100 0 L 0 0 0 100" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-accent"/>
                <circle cx="0" cy="0" r="2" fill="currentColor" className="text-accent"/>
                <circle cx="100" cy="0" r="2" fill="currentColor" className="text-accent"/>
                <circle cx="0" cy="100" r="2" fill="currentColor" className="text-accent"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#wire-grid-forgot)" />
          </svg>
        </div>
        <Card className="w-full max-w-md relative z-10 border-accent/20 shadow-glow-orange">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="flex justify-center">
              <div className="relative">
                <Mail className="h-20 w-20 text-accent" />
                <div className="absolute inset-0 animate-ping">
                  <CheckCircle className="h-20 w-20 text-accent opacity-20" />
                </div>
              </div>
            </div>
            <h2 className="text-2xl font-bold">Check Your Email</h2>
            <p className="text-muted-foreground">
              We've sent a password reset link to <strong className="text-accent">{email}</strong>
            </p>
            <p className="text-sm text-muted-foreground">
              Click the link in the email to reset your password. The link will expire in 1 hour.
            </p>
            <Link to="/auth/login" className="block pt-4">
              <Button className="w-full bg-accent hover:bg-accent/90 text-white">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Sign In
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
      {/* Animated Circuit Background */}
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="wire-grid-reset" width="100" height="100" patternUnits="userSpaceOnUse">
              <path d="M 100 0 L 0 0 0 100" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-accent"/>
              <circle cx="0" cy="0" r="2" fill="currentColor" className="text-accent"/>
              <circle cx="100" cy="0" r="2" fill="currentColor" className="text-accent"/>
              <circle cx="0" cy="100" r="2" fill="currentColor" className="text-accent"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#wire-grid-reset)" />
        </svg>
      </div>

      <Card className="w-full max-w-md relative z-10 border-accent/20 shadow-glow-orange">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="relative">
              <WireConnectorIcon />
              <div className="absolute inset-0 animate-ping opacity-20">
                <WireConnectorIcon />
              </div>
            </div>
          </div>
          <div>
            <CardTitle className="text-3xl font-bold">
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Bot Korp
              </span>
            </CardTitle>
            <CardDescription className="text-lg mt-2">Reconnect Your Account</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <Alert variant="destructive" className="border-destructive/50">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">Email</Label>
              <div className="relative">
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="border-accent/30 focus:border-accent transition-colors pl-10"
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-accent/50 rounded-full" />
              </div>
            </div>
            
            <Button 
              type="submit" 
              className="w-full bg-accent hover:bg-accent/90 text-white font-medium shadow-lg hover:shadow-glow-orange transition-all" 
              disabled={loading}
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending...
                </div>
              ) : (
                'Send Reset Link'
              )}
            </Button>
          </form>
          
          <div className="mt-6 text-center">
            <Link 
              to="/auth/login" 
              className="text-sm text-accent hover:text-accent/80 flex items-center justify-center gap-1 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Sign In</span>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default ForgotPassword
