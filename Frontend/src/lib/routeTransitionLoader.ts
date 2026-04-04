/**
 * Route loader so React Router enters `navigation.state === "loading"` during navigations.
 * Two animation frames give the progress bar + overlay a reliable chance to paint before idle.
 */
export async function routeTransitionLoader(): Promise<null> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
  return null;
}
