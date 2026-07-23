import { createRootRoute, createRoute, createRouter, RouterProvider, Outlet } from '@tanstack/react-router'
import LandingPage from './pages/landing/LandingPage'
import Pricing from './pages/landing/Pricing'
import NewMowerForm from './pages/dashboard/devices/NewMowerForm'
import TeamManagement from './pages/dashboard/settings/TeamManagement'

const rootRoute = createRootRoute({
	component: () => <div className="min-h-screen"><Outlet /></div>,
})

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/',
	component: LandingPage,
})

const pricingRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/pricing',
	component: Pricing,
})

const dashboardRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/dashboard',
	component: () => (
		<div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
			<h1 className="font-display text-3xl font-bold">Dashboard</h1>
			<section>
				<h2 className="text-xl font-semibold mb-3">Add Mower</h2>
				<NewMowerForm />
			</section>
			<section>
				<h2 className="text-xl font-semibold mb-3">Team Management</h2>
				<TeamManagement />
			</section>
		</div>
	),
})

const routeTree = rootRoute.addChildren([indexRoute, pricingRoute, dashboardRoute])

export const router = createRouter({ routeTree })

export function AppRouter() {
	return <RouterProvider router={router} />
} 