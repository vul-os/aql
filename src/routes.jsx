import React, { Suspense, lazy } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/auth/protected-route';
import StaffProtectedRoute from './components/auth/staff-protected-route';

import { Progress as LoadingComponent } from './components/ui/progress';
// Layouts
import BlankLayout from './components/layout/blank-layout';
import MainLayout from './components/layout/main-layout';
import LandingPage from './pages/landing';

// Loading message mapping
const getLoadingMessage = (pathname) => {
  if (pathname.includes('/signin')) return 'Loading sign in...';
  if (pathname.includes('/signup')) return 'Loading sign up...';
  if (pathname.includes('/staff-login')) return 'Loading staff login...';
  if (pathname.includes('/dashboard')) return 'Loading dashboard...';
  if (pathname.includes('/bots')) return 'Loading bots...';
  if (pathname.includes('/devices')) return 'Loading devices...';
  if (pathname.includes('/places')) return 'Loading places...';
  if (pathname.includes('/scenes')) return 'Loading scenes...';
  if (pathname.includes('/settings')) return 'Loading settings...';
  if (pathname.includes('/account')) return 'Loading account...';
  if (pathname.includes('/docs/privacy')) return 'Loading privacy policy...';
  if (pathname.includes('/docs/terms')) return 'Loading terms of service...';
  if (pathname.includes('/docs/cookies')) return 'Loading cookie policy...';
  if (pathname.includes('/docs/custom-avatar-url')) return 'Loading avatar guide...';
  if (pathname.includes('/docs')) return 'Loading documentation...';
  if (pathname === '/') return 'Loading homepage...';
  return 'Loading...';
};

// Custom Suspense wrapper with dynamic message
const CustomSuspense = ({ children }) => {
  const location = useLocation();
  const message = getLoadingMessage(location.pathname);
  
  return (
    <Suspense fallback={<LoadingComponent message={message} />}>
      {children}
    </Suspense>
  );
};

// Lazy imports
const lazyImport = (importFn) => {
  const Component = lazy(importFn);
  return Component;
};

// Lazy loaded components - Auth pages
const SignIn = lazyImport(() => import('./pages/auth/signin'));
const SignUp = lazyImport(() => import('./pages/auth/signup'));
const ForgotPassword = lazyImport(() => import('./pages/auth/forgot-password'));
const UpdatePassword = lazyImport(() => import('./pages/auth/update-password'));
const VerifyEmail = lazyImport(() => import('./pages/auth/verify-email'));

// Lazy loaded components - App pages
const Dashboard = lazyImport(() => import('./pages/dashboard'));
const BotsPage = lazyImport(() => import('./pages/bots'));
const BotDetailPage = lazyImport(() => import('./pages/bots/[id]'));
const DevicesPage = lazyImport(() => import('./pages/devices'));
const SettingsPage = lazyImport(() => import('./pages/settings'));

// Placeholder pages
const PlacesPage = lazyImport(() => Promise.resolve({ default: () => (
  <div className="container mx-auto px-4 py-8">
    <h1 className="text-3xl font-bold text-gray-900 mb-4">Places</h1>
    <p className="text-gray-600">Place management is available in Settings > Places</p>
  </div>
)}));

const ScenesPage = lazyImport(() => Promise.resolve({ default: () => (
  <div className="container mx-auto px-4 py-8">
    <h1 className="text-3xl font-bold text-gray-900 mb-4">Scenes</h1>
    <p className="text-gray-600">Scene management coming soon...</p>
  </div>
)}));

const AccountPage = lazyImport(() => Promise.resolve({ default: () => (
  <div className="container mx-auto px-4 py-8">
    <h1 className="text-3xl font-bold text-gray-900 mb-4">Account</h1>
    <p className="text-gray-600">Account management is available in Settings > Profile</p>
  </div>
)}));

// Documentation pages
const DocsIndex = lazyImport(() => Promise.resolve({ default: () => (
  <div className="container mx-auto px-4 py-8">
    <h1 className="text-3xl font-bold text-gray-900 mb-4">Documentation</h1>
    <div className="prose max-w-none">
      <h2>Getting Started</h2>
      <p>Welcome to Botserv! This platform helps you manage your bots and smart home devices from one central location.</p>
      
      <h3>Supported Bot Types</h3>
      <ul>
        <li><strong>MowBots:</strong> Automated lawn mowing robots with smart scheduling</li>
        <li><strong>PoolBots:</strong> Pool cleaning robots with maintenance scheduling</li>
        <li><strong>Weather Stations:</strong> Environmental sensors for weather and soil data</li>
      </ul>

      <h3>Smart Home Devices</h3>
      <p>Botserv supports a wide range of smart home devices including:</p>
      <ul>
        <li>Smart lights, switches, and dimmers</li>
        <li>Smart plugs and outlets</li>
        <li>Air conditioners and heaters</li>
        <li>Smart TVs and entertainment systems</li>
        <li>Security cameras and door locks</li>
        <li>Appliances like washing machines and coffee makers</li>
        <li>Garden devices like sprinklers and gates</li>
      </ul>

      <h3>Key Features</h3>
      <ul>
        <li><strong>Unified Dashboard:</strong> Control all devices from one interface</li>
        <li><strong>Scene Management:</strong> Create predefined device configurations</li>
        <li><strong>Automation Scheduling:</strong> Set up automated schedules for any device</li>
        <li><strong>Real-time Control:</strong> Send commands and monitor device states</li>
        <li><strong>Multi-place Support:</strong> Manage multiple properties</li>
      </ul>

      <h3>Getting Help</h3>
      <p>If you need assistance, please contact us at <a href="mailto:botservza@gmail.com">botservza@gmail.com</a></p>
    </div>
  </div>
)}));

const DocsPrivacyPolicy = lazyImport(() => Promise.resolve({ default: () => (
  <div className="container mx-auto px-4 py-8">
    <h1 className="text-3xl font-bold text-gray-900 mb-4">Privacy Policy</h1>
    <div className="prose max-w-none">
      <p><strong>Last updated:</strong> December 2024</p>
      
      <h2>Information We Collect</h2>
      <p>We collect information you provide directly to us, such as when you create an account, use our services, or contact us for support.</p>
      
      <h2>How We Use Your Information</h2>
      <p>We use the information we collect to provide, maintain, and improve our services, process transactions, and communicate with you.</p>
      
      <h2>Information Sharing</h2>
      <p>We do not sell, trade, or otherwise transfer your personal information to third parties without your consent, except as described in this policy.</p>
      
      <h2>Data Security</h2>
      <p>We implement appropriate security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.</p>
      
      <h2>Contact Us</h2>
      <p>If you have any questions about this Privacy Policy, please contact us at <a href="mailto:botservza@gmail.com">botservza@gmail.com</a></p>
    </div>
  </div>
)}));

const DocsTermsOfService = lazyImport(() => Promise.resolve({ default: () => (
  <div className="container mx-auto px-4 py-8">
    <h1 className="text-3xl font-bold text-gray-900 mb-4">Terms of Service</h1>
    <div className="prose max-w-none">
      <p><strong>Last updated:</strong> December 2024</p>
      
      <h2>Acceptance of Terms</h2>
      <p>By accessing and using Botserv, you accept and agree to be bound by the terms and provision of this agreement.</p>
      
      <h2>Use License</h2>
      <p>Permission is granted to temporarily use Botserv for personal, non-commercial transitory viewing only.</p>
      
      <h2>Disclaimer</h2>
      <p>The materials on Botserv are provided on an 'as is' basis. Botserv makes no warranties, expressed or implied.</p>
      
      <h2>Limitations</h2>
      <p>In no event shall Botserv or its suppliers be liable for any damages arising out of the use or inability to use the materials on Botserv.</p>
      
      <h2>Contact Information</h2>
      <p>If you have any questions about these Terms of Service, please contact us at <a href="mailto:botservza@gmail.com">botservza@gmail.com</a></p>
    </div>
  </div>
)}));

const DocsCookiesPolicy = lazyImport(() => Promise.resolve({ default: () => (
  <div className="container mx-auto px-4 py-8">
    <h1 className="text-3xl font-bold text-gray-900 mb-4">Cookie Policy</h1>
    <div className="prose max-w-none">
      <p><strong>Last updated:</strong> December 2024</p>
      
      <h2>What Are Cookies</h2>
      <p>Cookies are small text files that are placed on your computer or mobile device when you visit our website.</p>
      
      <h2>How We Use Cookies</h2>
      <p>We use cookies to improve your experience on our website, analyze site traffic, and personalize content.</p>
      
      <h2>Types of Cookies</h2>
      <ul>
        <li><strong>Essential Cookies:</strong> Necessary for the website to function properly</li>
        <li><strong>Analytics Cookies:</strong> Help us understand how visitors interact with our website</li>
        <li><strong>Preference Cookies:</strong> Remember your preferences and settings</li>
      </ul>
      
      <h2>Managing Cookies</h2>
      <p>You can control and/or delete cookies as you wish through your browser settings.</p>
      
      <h2>Contact Us</h2>
      <p>If you have any questions about our Cookie Policy, please contact us at <a href="mailto:botservza@gmail.com">botservza@gmail.com</a></p>
    </div>
  </div>
)}));

const DocsCustomAvatarUrl = lazyImport(() => Promise.resolve({ default: () => (
  <div className="container mx-auto px-4 py-8">
    <h1 className="text-3xl font-bold text-gray-900 mb-4">Custom Avatar URL Guide</h1>
    <div className="prose max-w-none">
      <p>This feature is coming soon. You'll be able to customize your profile avatar with a custom URL.</p>
    </div>
  </div>
)}));

// Other pages
const NotFound = lazyImport(() => import('./pages/not-found'));

const Protected = ({ children }) => (
  <ProtectedRoute>{children}</ProtectedRoute>
);

const StaffProtected = ({ children }) => (
  <StaffProtectedRoute>{children}</StaffProtectedRoute>
);

const AppRoutes = () => {
  return (
    <CustomSuspense>
      <Routes>
        {/* Public routes with blank layout */}
        <Route element={<BlankLayout />}>
          {/* Auth routes */}
          <Route path="/auth/signin" element={<SignIn />} />
          <Route path="/auth/signup" element={<SignUp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/update-password" element={<UpdatePassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          
          {/* Legacy redirects for old auth routes */}
          <Route path="/signin" element={<Navigate to="/auth/signin" replace />} />
          <Route path="/signup" element={<Navigate to="/auth/signup" replace />} />
        </Route>

        {/* Public routes with main layout */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/docs" element={<DocsIndex />} />
          <Route path="/docs/privacy" element={<DocsPrivacyPolicy />} />
          <Route path="/docs/terms" element={<DocsTermsOfService />} />
          <Route path="/docs/cookies" element={<DocsCookiesPolicy />} />
          <Route path="/docs/custom-avatar-url" element={<DocsCustomAvatarUrl />} />
          
          {/* Legacy redirects for old legal routes */}
          <Route path="/privacy" element={<DocsPrivacyPolicy />} />
          <Route path="/terms" element={<DocsTermsOfService />} />
          <Route path="/cookies" element={<DocsCookiesPolicy />} />
        </Route>

        {/* Protected app routes */}
        <Route element={<MainLayout />}>
          <Route path="/dashboard" element={
            <Protected>
              <Dashboard />
            </Protected>
          } />
          <Route path="/bots" element={
            <Protected>
              <BotsPage />
            </Protected>
          } />
          <Route path="/bots/:id" element={
            <Protected>
              <BotDetailPage />
            </Protected>
          } />
          <Route path="/devices" element={
            <Protected>
              <DevicesPage />
            </Protected>
          } />
          <Route path="/places" element={
            <Protected>
              <PlacesPage />
            </Protected>
          } />
          <Route path="/scenes" element={
            <Protected>
              <ScenesPage />
            </Protected>
          } />
          
          {/* Settings routes */}
          <Route path="/settings" element={
            <Protected>
              <SettingsPage />
            </Protected>
          } />
          
          <Route path="/account" element={
            <Protected>
              <AccountPage />
            </Protected>
          } />
        </Route>

        {/* 404 Route */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </CustomSuspense>
  );
};

export default AppRoutes;
