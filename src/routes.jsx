import React, { Suspense, lazy } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/auth/protected-route';

// Layouts
import BlankLayout from './components/layout/blank-layout';
import PortalLayout from './components/layout/portal-layout';
import DocsLayout from './components/layout/docs-layout';

// Landing page
import LandingPage from './pages/landing/landing-page';

// Loading component
const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
  </div>
);

// Custom Suspense wrapper
const CustomSuspense = ({ children }) => {
  return (
    <Suspense fallback={<LoadingFallback />}>
      {children}
    </Suspense>
  );
};

// Lazy imports
const lazyImport = (importFn) => {
  const Component = lazy(importFn);
  return Component;
};

// Auth pages
const SignIn = lazyImport(() => import('./pages/auth/signin'));
const SignUp = lazyImport(() => import('./pages/auth/signup'));
const ForgotPassword = lazyImport(() => import('./pages/auth/forgot-password'));
const UpdatePassword = lazyImport(() => import('./pages/auth/update-password'));
const VerifyEmail = lazyImport(() => import('./pages/auth/verify-email'));
const AcceptInvite = lazyImport(() => import('./pages/auth/accept-invite'));

// Portal pages
const DashboardPage = lazyImport(() => import('./pages/dashboard/dashboard-page'));
const ServicesPage = lazyImport(() => import('./pages/services/services-page'));
const GardenDetailPage = lazyImport(() => import('./pages/services/garden-detail-page'));
const AddServicePage = lazyImport(() => import('./pages/services/add-service-page'));
const AddServicePublic = lazyImport(() => import('./pages/services/add-service-public'));
const SchedulesPage = lazyImport(() => import('./pages/services/schedules-page'));
const SettingsPage = lazyImport(() => import('./pages/settings/settings-page'));
const BillingPage = lazyImport(() => import('./pages/settings/billing-page'));
const MembersPage = lazyImport(() => import('./pages/members/members-page'));

// Docs pages
const DocsHome = lazyImport(() => import('./pages/docs/docs-home'));
const FAQPage = lazyImport(() => import('./pages/docs/faq-page'));
const PrivacyPolicyPage = lazyImport(() => import('./pages/docs/privacy-policy-page'));
const TermsOfServicePage = lazyImport(() => import('./pages/docs/terms-of-service-page'));
const CookiePolicyPage = lazyImport(() => import('./pages/docs/cookie-policy-page'));

// 404 page
const NotFound = lazyImport(() => import('./pages/not-found'));

const Protected = ({ children }) => (
  <ProtectedRoute>{children}</ProtectedRoute>
);

const AppRoutes = () => {
  return (
    <CustomSuspense>
      <Routes>
        {/* Public landing page */}
        <Route path="/" element={<LandingPage />} />

        {/* Accept invitation (public, no layout) */}
        <Route path="/accept-invite/:token" element={<AcceptInvite />} />

        {/* Auth routes with blank layout */}
        <Route element={<BlankLayout />}>
          <Route path="/auth/login" element={<SignIn />} />
          <Route path="/auth/register" element={<SignUp />} />
          <Route path="/auth/forgot-password" element={<ForgotPassword />} />
          <Route path="/auth/update-password" element={<UpdatePassword />} />
          <Route path="/auth/verify-email" element={<VerifyEmail />} />
          
          {/* Legacy redirects */}
          <Route path="/auth/signin" element={<Navigate to="/auth/login" replace />} />
          <Route path="/auth/signup" element={<Navigate to="/auth/register" replace />} />
          <Route path="/signin" element={<Navigate to="/auth/login" replace />} />
          <Route path="/signup" element={<Navigate to="/auth/register" replace />} />
        </Route>

        {/* Public add service route (for landing page) */}
        <Route path="/add-service" element={<AddServicePublic />} />

        {/* Protected portal routes */}
        <Route path="/portal" element={
          <Protected>
            <PortalLayout />
          </Protected>
        }>
          {/* Dashboard (default portal page) */}
          <Route index element={<DashboardPage />} />
          
          {/* Services */}
          <Route path="services" element={<ServicesPage />} />
          <Route path="services/add" element={<AddServicePage />} />
          <Route path="services/schedules" element={<SchedulesPage />} />
          <Route path="garden/:id" element={<GardenDetailPage />} />
          
          {/* Settings */}
          <Route path="settings" element={<SettingsPage />} />
          
          {/* Billing */}
          <Route path="billing" element={<BillingPage />} />
          
          {/* Members */}
          <Route path="members" element={<MembersPage />} />

          {/* Docs inside portal with portal-styled sidebar */}
          <Route path="docs" element={<DocsLayout />}>
            <Route index element={<DocsHome />} />
            <Route path="faq" element={<FAQPage />} />
            <Route path="privacy-policy" element={<PrivacyPolicyPage />} />
            <Route path="terms-of-service" element={<TermsOfServicePage />} />
            <Route path="cookie-policy" element={<CookiePolicyPage />} />
          </Route>
        </Route>

        {/* Docs routes */}
        <Route path="/docs" element={<DocsLayout />}>
          <Route index element={<DocsHome />} />
          <Route path="faq" element={<FAQPage />} />
          <Route path="privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="terms-of-service" element={<TermsOfServicePage />} />
          <Route path="cookie-policy" element={<CookiePolicyPage />} />
        </Route>

        {/* Legacy dashboard redirect */}
        <Route path="/dashboard" element={<Navigate to="/portal" replace />} />

        {/* 404 Route */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </CustomSuspense>
  );
};

export default AppRoutes;
