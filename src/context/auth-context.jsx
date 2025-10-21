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
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [isInitializing, setIsInitializing] = useState(true)
  
  // Organization and Location state
  const [organizations, setOrganizations] = useState([])
  const [selectedOrg, setSelectedOrg] = useState(null)
  const [locations, setLocations] = useState([])
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [orgLoading, setOrgLoading] = useState(false)

  const initializeAuth = useCallback(async (session) => {
    console.log('[AuthContext] initializeAuth called with session:', !!session)
    try {
      if (session?.user) {
        console.log('[AuthContext] Setting user and session')
        setUser(session.user)
        setSession(session)
        setLoading(false)
      } else {
        console.log('[AuthContext] No session, clearing all state')
        setUser(null)
        setSession(null)
        setLoading(false)
      }
    } catch (error) {
      console.error('[AuthContext] Error in initializeAuth:', error)
      setLoading(false)
    }
  }, [])

  const handleAuthStateChange = useCallback(async (event, session) => {
    console.log('[AuthContext] Auth state changed:', event)
    
    // Set loading during auth state transitions
    setLoading(true)
    
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      console.log('[AuthContext] Sign in/refresh event')
      await initializeAuth(session)
      setIsInitializing(false)
    } else if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
      console.log('[AuthContext] Sign out event')
      await initializeAuth(null)
      setIsInitializing(false)
    } else if (event === 'USER_UPDATED') {
      console.log('[AuthContext] User updated event')
      setUser(session?.user ?? null)
      setSession(session)
      setLoading(false)
    } else if (event === 'INITIAL_SESSION') {
      console.log('[AuthContext] INITIAL_SESSION event')
      setLoading(false)
    }
  }, [initializeAuth])

  useEffect(() => {
    let mounted = true
    let authSubscription = null

    const initializeAuthFlow = async () => {
      console.log('[AuthContext] Initial auth check starting')
      setLoading(true)
      
      try {
        // Set up auth state change listener
        const { data: { subscription } } = supabase.auth.onAuthStateChange(handleAuthStateChange)
        authSubscription = subscription
        
        // Get initial session
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) throw error
        
        if (mounted) {
          console.log('[AuthContext] Got initial session:', !!session)
          await initializeAuth(session)
          setIsInitializing(false)
        }
      } catch (error) {
        console.error('[AuthContext] Error initializing auth:', error)
        
        if (mounted) {
          setLoading(false)
          setIsInitializing(false)
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
  }, [handleAuthStateChange, initializeAuth])

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

  // Load user's organizations
  const loadUserOrganizations = useCallback(async () => {
    if (!user) {
      setOrganizations([])
      setSelectedOrg(null)
      return
    }

    try {
      setOrgLoading(true)
      
      const { data, error } = await supabase.rpc('get_user_organizations', {
        user_uuid: user.id
      })

      if (error) throw error

      setOrganizations(data || [])
      
      // Auto-select organization from localStorage or first available
      const savedOrgId = localStorage.getItem('selectedOrgId')
      const orgToSelect = data?.find(o => o.organization_id === savedOrgId) || data?.[0]
      
      if (orgToSelect) {
        setSelectedOrg(orgToSelect)
        localStorage.setItem('selectedOrgId', orgToSelect.organization_id)
      } else {
        setSelectedOrg(null)
        localStorage.removeItem('selectedOrgId')
      }
    } catch (error) {
      console.error('Error loading organizations:', error)
      setOrganizations([])
      setSelectedOrg(null)
    } finally {
      setOrgLoading(false)
    }
  }, [user])

  // Load locations for selected organization
  const loadOrganizationLocations = useCallback(async () => {
    if (!selectedOrg?.organization_id) {
      setLocations([])
      setSelectedLocation(null)
      return
    }

    try {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', selectedOrg.organization_id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })

      if (error) throw error

      setLocations(data || [])

      // Auto-select location from localStorage or first available (oldest created)
      const savedLocationId = localStorage.getItem('selectedLocationId')
      const locToSelect = (data || []).find(l => String(l.id) === String(savedLocationId)) || data?.[0] || null
      
      if (locToSelect) {
        setSelectedLocation(locToSelect)
        localStorage.setItem('selectedLocationId', locToSelect.id)
      } else {
        setSelectedLocation(null)
        localStorage.removeItem('selectedLocationId')
      }
    } catch (error) {
      console.error('Error loading locations:', error)
      setLocations([])
      setSelectedLocation(null)
    }
  }, [selectedOrg])

  // Change active organization
  const changeOrganization = useCallback((org) => {
    setSelectedOrg(org)
    localStorage.setItem('selectedOrgId', org.organization_id)
    console.log('[AuthContext] Organization changed to:', org.organization_name)
  }, [])

  // Change active location
  const changeLocation = useCallback((loc) => {
    setSelectedLocation(loc)
    if (loc?.id) {
      localStorage.setItem('selectedLocationId', loc.id)
    } else {
      localStorage.removeItem('selectedLocationId')
    }
    console.log('[AuthContext] Location changed to:', loc?.name || 'none')
  }, [])

  // Load organizations when user changes
  useEffect(() => {
    loadUserOrganizations()
  }, [loadUserOrganizations])

  // Load locations when organization changes
  useEffect(() => {
    loadOrganizationLocations()
  }, [loadOrganizationLocations])

  // Clear org/location data on sign out
  useEffect(() => {
    if (!user) {
      setOrganizations([])
      setSelectedOrg(null)
      setLocations([])
      setSelectedLocation(null)
      localStorage.removeItem('selectedOrgId')
      localStorage.removeItem('selectedLocationId')
    }
  }, [user])

  const value = {
    // Auth
    user,
    session,
    loading,
    isInitializing,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    
    // Organization & Location
    organizations,
    selectedOrg,
    locations,
    selectedLocation,
    orgLoading,
    loadUserOrganizations,
    loadOrganizationLocations,
    changeOrganization,
    changeLocation,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
