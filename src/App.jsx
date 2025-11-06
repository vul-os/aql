import React from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/auth-context';
import AppRoutes from './routes';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from '@/components/theme-provider';
import usePageTracking from './hooks/usePageTracking';

// Create a client for React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

// Wrapper component that provides navigation functionality
const AuthWrapper = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Track page views automatically
  usePageTracking();

  return (
    <AuthProvider 
      onNavigate={(path) => navigate(path, { replace: true })} 
      pathname={location.pathname}
    >
      <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <AppRoutes />
        <Toaster />
      </ThemeProvider>
    </AuthProvider>
  );
};

// Main App component
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Routes>
          <Route path="/*" element={<AuthWrapper />} />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}

export default App;