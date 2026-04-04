import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar";
import { PostAuthRedirect } from "./components/PostAuthRedirect";
import { NavigationLoadingOverlay, NavigationProgress, RoutePendingFallback } from "./components/PageTransitions";
import { RouteTransitionGateProvider, useShowRouteTransitionChrome } from "./context/RouteTransitionGate";
import { ToastProvider } from "./context/ToastContext";

function MainChrome() {
  const location = useLocation();
  const routeChromeActive = useShowRouteTransitionChrome();
  const hasNav = location.pathname !== "/";

  return (
    <>
      <PostAuthRedirect />
      <NavigationProgress />
      {hasNav && <Navbar />}
      <main
        id="main-content"
        className={`relative ${hasNav ? "min-h-[calc(100dvh-3.5rem)]" : "min-h-dvh"}`}
        aria-busy={routeChromeActive}
        aria-live="polite"
      >
        <NavigationLoadingOverlay />
        <Suspense fallback={<RoutePendingFallback />}>
          <Outlet />
        </Suspense>
      </main>
    </>
  );
}

export function RootLayout() {
  return (
    <RouteTransitionGateProvider>
      <ToastProvider>
        <MainChrome />
      </ToastProvider>
    </RouteTransitionGateProvider>
  );
}
