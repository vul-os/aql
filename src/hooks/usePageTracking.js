import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const usePageTracking = () => {
  const location = useLocation()

  useEffect(() => {
    // Track page view
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('config', 'GA_MEASUREMENT_ID', {
        page_path: location.pathname,
      })
    }
  }, [location])
}

export default usePageTracking
