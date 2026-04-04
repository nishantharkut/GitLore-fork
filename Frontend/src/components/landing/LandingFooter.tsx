import { Link } from "react-router-dom";

const REPO_URL = "https://github.com/sneharathod7/GitLore";

const footerLinkClass =
  "font-body text-[13px] font-normal tracking-[-0.01em] text-gitlore-text-secondary transition-colors duration-200 hover:text-[var(--accent)]";

const FooterColTitle = ({ children }: { children: string }) => (
  <p className="mb-4 font-code text-[10px] font-medium uppercase tracking-[3px]" style={{ color: "var(--text-ghost)" }}>
    {children}
  </p>
);

const LandingFooter = () => {
  return (
    <footer className="relative overflow-hidden border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-sm">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/35 to-transparent"
        aria-hidden
      />
      <div className="landing-container">
        <div className="grid grid-cols-1 gap-12 py-14 md:grid-cols-12 md:gap-10 md:py-16 lg:gap-12">
          <div className="md:col-span-5 lg:col-span-4">
            <Link to="/" className="group inline-flex items-center gap-2.5">
              <span
                className="h-2 w-2 shrink-0 rounded-sm shadow-[0_0_10px_var(--accent-glow)] transition-transform duration-300 group-hover:scale-110"
                style={{ background: "var(--accent)" }}
                aria-hidden
              />
              <span className="font-heading text-[17px] font-semibold tracking-tight transition-colors group-hover:text-[var(--accent)]" style={{ color: "var(--text)" }}>
                GitLore
              </span>
            </Link>
            <p className="mt-4 max-w-[320px] font-body text-[14px] font-normal leading-[1.65]" style={{ color: "var(--text-secondary)", letterSpacing: "-0.01em" }}>
              Institutional memory for your codebase.
            </p>
          </div>

          <nav className="md:col-span-7 lg:col-span-5" aria-label="Product">
            <FooterColTitle>Product</FooterColTitle>
            <ul className="flex flex-col gap-2.5">
              <li>
                <Link to="/overview" className={footerLinkClass}>
                  Overview
                </Link>
              </li>
              <li>
                <Link to="/app" className={footerLinkClass}>
                  Knowledge Graph
                </Link>
              </li>
              <li>
                <Link to="/patterns" className={footerLinkClass}>
                  Patterns
                </Link>
              </li>
              <li>
                <a href="#chrome-extension" className={footerLinkClass}>
                  Chrome Extension
                </a>
              </li>
            </ul>
          </nav>

          <div className="md:col-span-12 lg:col-span-3 lg:border-l lg:pl-10" style={{ borderColor: "var(--border)" }}>
            <FooterColTitle>Build</FooterColTitle>
            <p className="font-code text-[11px] font-normal leading-relaxed" style={{ color: "var(--text-ghost)", letterSpacing: "0.02em" }}>
              HackByte 4.0 · IIITDM Jabalpur · April 2026
            </p>
          </div>
        </div>

        <div className="border-t py-8" style={{ borderColor: "var(--border)" }}>
          <div
            className="rounded-2xl border px-5 py-5 md:px-6 md:py-5"
            style={{
              borderColor: "var(--border)",
              background: "color-mix(in srgb, var(--elevated) 88%, transparent)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <p className="font-code text-[10px] font-medium uppercase tracking-[2px]" style={{ color: "var(--text-ghost)" }}>
              Privacy
            </p>
            <p className="mt-2 max-w-[820px] font-body text-[12px] font-normal leading-[1.7] md:text-[13px]" style={{ color: "var(--text-secondary)", letterSpacing: "-0.01em" }}>
              GitLore reads repository metadata through the GitHub API. Your code stays on GitHub. We don&apos;t use your repositories to train models.
            </p>
          </div>
        </div>

        <div
          className="flex flex-col items-center justify-between gap-3 py-6 sm:flex-row sm:gap-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <p className="order-2 font-code text-[10px] font-normal sm:order-1" style={{ color: "var(--text-ghost)", letterSpacing: "0.04em" }}>
            © {new Date().getFullYear()} GitLore
          </p>
          <div className="order-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:order-2 sm:justify-end">
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={footerLinkClass}>
              Source code
            </a>
            <a href="#live-demo" className={footerLinkClass}>
              Try the demo
            </a>
            <a href="#landing-top" className={footerLinkClass}>
              Back to top
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default LandingFooter;
