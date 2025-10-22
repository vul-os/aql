import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/context/auth-context'
import LoadingLottie from '@/components/ui/loading-lottie'

const StaffProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <LoadingLottie 
          src="https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie"
          message="Loading..." 
          size="md" 
        />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/auth/login" replace />
  }

  // For now, we'll allow all authenticated users
  // Later we can add role-based access control
  return children
}

export default StaffProtectedRoute
