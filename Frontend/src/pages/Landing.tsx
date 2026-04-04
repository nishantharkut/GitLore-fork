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
    <div className="bg-[var(--bg)] text-[var(--text)]">
      {oauthError && (
        <div
          className="fixed left-0 right-0 top-[52px] z-[90] border-b border-gitlore-error/30 bg-gitlore-error/15 px-5 py-2 text-center text-sm text-gitlore-error"
          role="alert"
        >
          GitHub sign-in was cancelled or failed ({oauthError}). Try again from Connect.
        </div>
      )}
      <LandingNavbar />
      <HeroSection />
      <Suspense fallback={<LandingBelowFoldSkeleton />}>
        <LandingBelowFold />
      </Suspense>
    </div>
  );
};

export default Landing;
