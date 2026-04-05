import { FadeIn } from "../effects/FadeIn";
import { useTheme } from "@/context/ThemeContext";

const LOGO_BASE = `${import.meta.env.BASE_URL}landing-logos`;

type IconTone = "gold" | "green" | "slate" | "violet";

type StackCard = {
  name: string;
  use: string;
  why: string;
  iconTone: IconTone;
  /** One or more logo files in `public/landing-logos/` */
  logos: { src: string; alt: string }[];
};

const cards: StackCard[] = [
  {
    name: "Gemini 2.5 Flash",
    use: "Decision extraction, chat synthesis, review explanation, voice translation",
    why: "8 distinct uses across the platform. Structured JSON extraction. Flash-lite for batch ingest (cost), Flash for explanations (quality).",
    iconTone: "violet",
    logos: [{ src: `${LOGO_BASE}/googlegemini.svg`, alt: "Google Gemini" }],
  },
  {
    name: "MongoDB Atlas",
    use: "6 collections, vector search indexes, change streams",
    why: "Atlas Vector Search for sub-second semantic retrieval. Free M0 tier. Real-time change streams for live updates.",
    iconTone: "green",
    logos: [{ src: `${LOGO_BASE}/mongodb.svg`, alt: "MongoDB" }],
  },
  {
    name: "GitHub GraphQL + REST",
    use: "PR fetching, blame data, file content, OAuth",
    why: "GraphQL for efficient batch PR fetching: one call for PR + reviews + issues. REST for file content and blame.",
    iconTone: "slate",
    logos: [{ src: `${LOGO_BASE}/github.svg`, alt: "GitHub" }],
  },
  {
    name: "ElevenLabs",
    use: "Text-to-speech in English and Hindi, voice agent",
    why: "eleven_turbo_v2_5 for natural narration. Hindi via Gemini translation + dedicated voice. WebRTC voice agent for Q&A.",
    iconTone: "violet",
    logos: [{ src: `${LOGO_BASE}/elevenlabs.svg`, alt: "ElevenLabs" }],
  },
  {
    name: "ArmorIQ",
    use: "Security enforcement layer",
    why: "18 tool actions classified by risk level. Policy-based allow/deny. Enforcement logging.",
    iconTone: "gold",
    logos: [{ src: `${LOGO_BASE}/armoriq.png`, alt: "ArmorIQ" }],
  },
  {
    name: "SuperPlane",
    use: "Event-driven DevOps automation",
    why: "3 canvases: auto-explain reviews, auto-ingest on merge, proactive decision alerts on new PRs.",
    iconTone: "gold",
    logos: [{ src: `${LOGO_BASE}/superplane.svg`, alt: "SuperPlane" }],
  },
  {
    name: "Hono + Node.js",
    use: "Backend API",
    why: "30+ endpoints. Lightweight, TypeScript-native.",
    iconTone: "green",
    logos: [
      { src: `${LOGO_BASE}/hono.svg`, alt: "Hono" },
      { src: `${LOGO_BASE}/nodedotjs.svg`, alt: "Node.js" },
    ],
  },
  {
    name: "React + TypeScript",
    use: "Frontend",
    why: "CodeMirror for code display. GSAP + anime.js for animations. react-markdown for chat rendering.",
    iconTone: "slate",
    logos: [
      { src: `${LOGO_BASE}/react.svg`, alt: "React" },
      { src: `${LOGO_BASE}/typescript.svg`, alt: "TypeScript" },
    ],
  },
];

const toneClasses: Record<IconTone, string> = {
  gold: "bg-[var(--accent)]/14",
  green: "bg-emerald-500/10",
  slate: "bg-[var(--text-secondary)]/10",
  violet: "bg-violet-500/10 dark:bg-violet-500/12",
};

function BrandLogos({ logos, pair }: { logos: StackCard["logos"]; pair: boolean }) {
  const { theme } = useTheme();

  return (
    <div className={`flex shrink-0 items-center justify-center ${pair ? "gap-2 px-1" : ""}`}>
      {logos.map((logo) => {
        const raster = /\.(png|jpe?g|webp)$/i.test(logo.src);
        const monoNight = theme === "dark" && !raster;
        return (
          <img
            key={logo.src}
            src={logo.src}
            alt={logo.alt}
            title={logo.alt}
            className={`object-contain ${pair ? "h-7 w-7 sm:h-8 sm:w-8" : "h-8 w-8 sm:h-9 sm:w-9"} ${
              monoNight ? "brightness-0 invert opacity-[0.92]" : ""
            }`}
            loading="lazy"
            decoding="async"
          />
        );
      })}
    </div>
  );
}

function StackCardItem({ card }: { card: StackCard }) {
  const pair = card.logos.length > 1;
  return (
    <article
      className="bento-card group relative flex h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--accent)]/35 opacity-80" aria-hidden />
      {/* Row 2 uses minmax(_,auto): short “why” copy (e.g. Hono) was shrinking that row and shifting the divider vs neighbors. Floor matches ~3 lines of body + label + padding. */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(8.25rem,auto)] gap-5">
        <div className="flex min-h-0 min-w-0 flex-col gap-4 sm:flex-row sm:items-stretch">
          <div
            className={`flex min-h-[3.5rem] min-w-[3.5rem] shrink-0 items-center justify-center rounded-[6px] border border-[var(--border)] sm:self-start ${toneClasses[card.iconTone]} ${pair ? "min-w-[5.25rem] px-2" : ""}`}
          >
            <BrandLogos logos={card.logos} pair={pair} />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col pt-0.5">
            <h3 className="shrink-0 font-heading text-[16px] font-bold tracking-[-0.02em] text-[var(--text)] md:text-[17px]">{card.name}</h3>
            <p className="mt-2 shrink-0 font-code text-[11px] font-semibold uppercase tracking-[0.12em] text-[color-mix(in_srgb,var(--text)_72%,var(--text-secondary))]">
              What we use it for
            </p>
            <div className="mt-1 flex min-h-0 flex-1 flex-col">
              <p className="font-body text-[13px] leading-relaxed text-[var(--text-secondary)] md:text-[14px]">{card.use}</p>
            </div>
          </div>
        </div>
        <div className="min-h-0 border-t border-[var(--border-strong)]/80 pt-4">
          <p className="font-code text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Why this one</p>
          <p className="mt-2 font-body text-[12px] leading-[1.75] text-[var(--text-secondary)] md:text-[13px]">{card.why}</p>
        </div>
      </div>
    </article>
  );
}

const BuiltWith = () => {
  return (
    <section id="technology" className="relative overflow-hidden border-y border-[var(--border)] bg-[var(--bg)] py-16 md:py-28">
      <div className="landing-container relative z-[1] min-w-0 max-w-[960px] lg:max-w-[1180px]">
        <FadeIn direction="up">
          <div className="section-label">
            <p>Stack</p>
          </div>
          <h2 className="font-heading text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-[-0.04em] text-[var(--text)]">Built With</h2>
          <p className="mt-2 max-w-[560px] font-body text-[15px] leading-relaxed text-[var(--text-secondary)] md:text-[16px]">
            Every technology chosen for a reason.
          </p>
          <p className="mt-3 max-w-[640px] font-code text-[10px] leading-relaxed text-[var(--text-ghost)]">
            Logos from{" "}
            <a
              href="https://github.com/simple-icons/simple-icons"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[var(--border-strong)] underline-offset-2 hover:text-[var(--accent)]"
            >
              Simple Icons
            </a>{" "}
            (CC0) where available; ArmorIQ and SuperPlane from their official sources.
          </p>

          <div className="mt-10 grid grid-cols-1 items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
            {cards.map((card) => (
              <StackCardItem key={card.name} card={card} />
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
};

export default BuiltWith;
