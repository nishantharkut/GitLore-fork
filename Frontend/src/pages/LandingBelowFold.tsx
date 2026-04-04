import StatsBar from "../components/landing/StatsBar";
import PainStatement from "../components/landing/PainStatement";
import BentoGrid from "../components/landing/BentoGrid";
import Comparison from "../components/landing/Comparison";
import HowItWorks from "../components/landing/HowItWorks";
import KnowledgeGraph from "../components/landing/KnowledgeGraph";
import FinalCTA from "../components/landing/FinalCTA";
import LandingFooter from "../components/landing/LandingFooter";

/**
 * Heavy landing sections loaded in a separate chunk after hero (LCP).
 * Imported only via `React.lazy` from `Landing.tsx`.
 */
export default function LandingBelowFold() {
  return (
    <>
      <StatsBar />
      <PainStatement />
      <BentoGrid />
      <Comparison />
      <HowItWorks />
      <KnowledgeGraph />
      <FinalCTA />
      <LandingFooter />
    </>
  );
}
