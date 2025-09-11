import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/context/auth-context'

const StaffProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-600"></div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/auth/signin" replace />
  }

  // For now, we'll allow all authenticated users
  // Later we can add role-based access control
  return children
}

export default StaffProtectedRoute
