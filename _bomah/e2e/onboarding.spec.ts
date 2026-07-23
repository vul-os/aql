import { test, expect } from '@playwright/test'

test('landing page loads', async ({ page }) => {
	await page.goto('/')
	await expect(page.getByText('Smart Garden & Pool Care, Perfected')).toBeVisible()
}) 