import { lazy, Suspense, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import LandingNavbar from "../components/landing/LandingNavbar";
import HeroSection from "../components/landing/HeroSection";
import { LandingBelowFoldSkeleton } from "../components/Skeleton";

const LandingBelowFold = lazy(() => import("./LandingBelowFold"));

const Landing = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const oauthError = searchParams.get("error");

  useEffect(() => {
    if (!oauthError) return;
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      next.delete("error");
      setSearchParams(next, { replace: true });
    }, 8000);
    return () => window.clearTimeout(t);
  }, [oauthError, searchParams, setSearchParams]);

  return (
    <div id="landing-top" className="landing-page min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-[var(--bg)] text-[var(--text)] antialiased">
      <div className="landing-fixed-backdrop" aria-hidden>
        <div className="landing-fixed-backdrop__glow" />
        <div className="landing-fixed-backdrop__grid" />
        <div className="landing-fixed-backdrop__noise" />
      </div>
      {oauthError && (
        <div
          className="fixed left-0 right-0 top-[52px] z-[90] border-b border-gitlore-error/30 bg-gitlore-error/15 py-2 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] text-center text-sm text-gitlore-error backdrop-blur-sm [overflow-wrap:anywhere]"
          role="alert"
        >
          GitHub sign-in was cancelled or failed ({oauthError}). Try again from Connect.
        </div>
      )}
      <div className="landing-content w-full max-w-[100vw] overflow-x-hidden">
        <LandingNavbar />
        <HeroSection />
        <Suspense fallback={<LandingBelowFoldSkeleton />}>
          <LandingBelowFold />
        </Suspense>
      </div>
    </div>
  );
};

export default Landing;
