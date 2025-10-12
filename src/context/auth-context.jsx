import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const AuthContext = createContext({})

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export const AuthProvider = ({ children, onNavigate, pathname }) => {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [isInitializing, setIsInitializing] = useState(true)

  // Define fetchProfile first
  const fetchProfile = useCallback(async (userId) => {
    console.log('[AuthContext] Starting fetchProfile for:', userId)
    try {
      // Timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Profile fetch timeout')), 2000)
      )

      const fetchPromise = supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      console.log('[AuthContext] Waiting for profile query...')
      const result = await Promise.race([fetchPromise, timeoutPromise])

      if (result.error) {
        console.error('[AuthContext] Error fetching profile:', result.error)
        // Set a minimal profile to allow login even if profile fetch fails
        setProfile({ id: userId, email: null })
      } else if (result.data) {
        console.log('[AuthContext] Profile fetched successfully')
        setProfile(result.data)
      } else {
        console.warn('[AuthContext] No data returned')
        setProfile({ id: userId, email: null })
      }
    } catch (error) {
      console.error('[AuthContext] Exception fetching profile:', error.message)
      // Set a minimal profile to allow login even if profile fetch fails
      setProfile({ id: userId, email: null })
    } finally {
      console.log('[AuthContext] fetchProfile complete')
      setLoading(false)
    }
  }, [])

  const initializeAuth = useCallback(async (session) => {
    console.log('[AuthContext] initializeAuth called with session:', !!session)
    try {
      if (session?.user) {
        console.log('[AuthContext] Setting user and session')
        setUser(session.user)
        setSession(session)
        // Fetch profile for authenticated user
        await fetchProfile(session.user.id)
      } else {
        console.log('[AuthContext] No session, clearing all state')
        setUser(null)
        setSession(null)
        setProfile(null)
        setLoading(false)
      }
    } catch (error) {
      console.error('[AuthContext] Error in initializeAuth:', error)
      setLoading(false)
    }
  }, [fetchProfile])

  const handleAuthStateChange = useCallback(async (event, session) => {
    console.log('[AuthContext] Auth state changed:', event, 'isInitializing:', isInitializing)
    
    // Set loading during auth state transitions
    setLoading(true)
    
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      console.log('[AuthContext] Sign in/refresh event, calling initializeAuth')
      await initializeAuth(session)
      setLoading(false)
      setIsInitializing(false)
    } else if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
      console.log('[AuthContext] Sign out event, calling initializeAuth')
      await initializeAuth(null)
      setLoading(false)
      setIsInitializing(false)
    } else if (event === 'USER_UPDATED') {
      console.log('[AuthContext] User updated event')
      setUser(session?.user ?? null)
      setSession(session)
      setLoading(false)
    } else if (event === 'INITIAL_SESSION') {
      // INITIAL_SESSION is already handled in the initialization flow
      console.log('[AuthContext] INITIAL_SESSION event (handled in init flow)')
      setLoading(false)
    }
  }, [initializeAuth, isInitializing])

  useEffect(() => {
    let mounted = true
    let authSubscription = null

    const initializeAuthFlow = async () => {
      console.log('[AuthContext] Initial auth check starting')
      setLoading(true)
      
      try {
        // Set up auth state change listener FIRST
        const { data: { subscription } } = supabase.auth.onAuthStateChange(handleAuthStateChange)
        authSubscription = subscription
        
        // Get initial session with timeout
        const sessionPromise = supabase.auth.getSession()
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Session check timeout')), 3000)
        )
        
        const { data: { session }, error } = await Promise.race([sessionPromise, timeoutPromise])
        
        if (error) throw error
        
        if (mounted) {
          console.log('[AuthContext] Got initial session:', !!session)
          await initializeAuth(session)
          setIsInitializing(false)
        }
      } catch (error) {
        console.error('[AuthContext] Error initializing auth:', error)
        
        if (mounted) {
          // Fallback timeout
          setTimeout(() => {
            if (mounted && loading) {
              console.log('[AuthContext] Fallback timeout reached, setting loading to false')
              setLoading(false)
              setIsInitializing(false)
            }
          }, 2000)
        }
      }
    }

    initializeAuthFlow()
    
    return () => {
      mounted = false
      if (authSubscription) {
        authSubscription.unsubscribe()
      }
    }
  }, [handleAuthStateChange]) // Add handleAuthStateChange as dependency

  const signUp = async (email, password, fullName) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      })
      return { data, error }
    } catch (error) {
      return { data: null, error }
    }
  }

  const signIn = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      return { data, error }
    } catch (error) {
      return { data: null, error }
    }
  }

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      if (!error) {
        setUser(null)
        setProfile(null)
        setSession(null)
        onNavigate('/')
      }
      return { error }
    } catch (error) {
      return { error }
    }
  }

  const resetPassword = async (email) => {
    try {
      const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/update-password`,
      })
      return { data, error }
    } catch (error) {
      return { data: null, error }
    }
  }

  const updatePassword = async (password) => {
    try {
      const { data, error } = await supabase.auth.updateUser({
        password,
      })
      return { data, error }
    } catch (error) {
      return { data: null, error }
    }
  }

  const updateProfile = async (updates) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single()

      if (!error && data) {
        setProfile(data)
      }
      return { data, error }
    } catch (error) {
      return { data: null, error }
    }
  }

  const value = {
    user,
    profile,
    session,
    loading,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    updateProfile,
    fetchProfile,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
