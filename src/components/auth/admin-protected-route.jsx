import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { AlertCircle } from 'lucide-react';
import LoadingLottie from '@/components/ui/loading-lottie';

/**
 * AdminProtectedRoute - Only allows admin users to access the route
 * 
 * For now, we check if user has 'admin' role in their profile metadata
 * or if they're in a special admin group
 */
const AdminProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAdminStatus();
  }, [user]);

  const checkAdminStatus = async () => {
    if (!user) {
      setIsAdmin(false);
      setChecking(false);
      return;
    }

    try {
      // Check if user has admin role in their profile
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role, is_admin')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('Error checking admin status:', error);
        setIsAdmin(false);
      } else {
        // User is admin if they have is_admin flag or role === 'admin'
        const adminStatus = profile?.is_admin === true || profile?.role === 'admin';
        setIsAdmin(adminStatus);
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
      setIsAdmin(false);
    } finally {
      setChecking(false);
    }
  };

  // Still loading auth state
  if (loading || checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <LoadingLottie 
          src="https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie"
          message="Verifying access..." 
          size="md" 
        />
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return <Navigate to="/auth/login" replace />;
  }

  // Not an admin
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4 max-w-md p-6">
          <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-4 inline-block">
            <AlertCircle className="h-12 w-12 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground">
            You don't have permission to access this admin area. 
            Please contact support if you believe this is an error.
          </p>
          <a 
            href="/portal" 
            className="inline-block mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Return to Portal
          </a>
        </div>
      </div>
    );
  }

  // User is authenticated and is admin
  return children;
};

export default AdminProtectedRoute;

