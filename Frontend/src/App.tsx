import { lazy, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar";
import { LandingSkeleton, PageSkeleton, AppSkeleton } from "./components/Skeleton";

const Landing = lazy(() => import("./pages/Landing"));
const AppView = lazy(() => import("./pages/AppView"));
const Patterns = lazy(() => import("./pages/Patterns"));
const Overview = lazy(() => import("./pages/Overview"));
const NotFound = lazy(() => import("./pages/NotFound"));

export default function App() {
  const location = useLocation();

  return (
    <>
      {location.pathname !== "/" && <Navbar />}
      <Routes>
        <Route path="/" element={<Suspense fallback={<LandingSkeleton />}><Landing /></Suspense>} />
        <Route path="/app" element={<Suspense fallback={<AppSkeleton />}><AppView /></Suspense>} />
        <Route path="/patterns" element={<Suspense fallback={<PageSkeleton />}><Patterns /></Suspense>} />
        <Route path="/overview" element={<Suspense fallback={<PageSkeleton />}><Overview /></Suspense>} />
        <Route path="*" element={<Suspense fallback={<PageSkeleton />}><NotFound /></Suspense>} />
      </Routes>
    </>
  );
}
