import StatsBar from "../components/landing/StatsBar";
import PainStatement from "../components/landing/PainStatement";
import ThreePillars from "../components/landing/ThreePillars";
import SupportingFeatures from "../components/landing/SupportingFeatures";
import Comparison from "../components/landing/Comparison";
import HowItWorks from "../components/landing/HowItWorks";
import BuiltWith from "../components/landing/BuiltWith";
import FinalCTA from "../components/landing/FinalCTA";
import LandingFooter from "../components/landing/LandingFooter";

/**
 * Below-the-fold landing sections (lazy-loaded from `Landing.tsx` for LCP).
 */
export default function LandingBelowFold() {
  return (
    <>
      <PainStatement />
      <ThreePillars />
      <SupportingFeatures />
      <Comparison />
      <HowItWorks />
      <BuiltWith />
      <StatsBar />
      <FinalCTA />
      <LandingFooter />
    </>
  );
}
