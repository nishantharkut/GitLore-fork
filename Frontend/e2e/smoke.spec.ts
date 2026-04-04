import { test, expect } from "@playwright/test";

test.describe("GitLore smoke", () => {
  test("landing loads with hero and document title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/GitLore/i);
    await expect(page.getByRole("heading", { name: /Click any line/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Get the full story/i })).toBeVisible();
  });

  test("unknown routes show 404 with home link", async ({ page }) => {
    await page.goto("/__e2e_not_found__/missing");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText(/Page not found/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Return to Home/i })).toHaveAttribute("href", "/");
  });

  test("oauth error query shows dismissible alert", async ({ page }) => {
    await page.goto("/?error=access_denied");
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/sign-in was cancelled or failed/i);
  });
});
