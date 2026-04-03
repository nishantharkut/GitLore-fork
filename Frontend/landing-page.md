Read Before Building Anything
This is the complete specification for gitlore-web's landing page at route /. It supersedes any previous version. The central design principle: this page does not describe the product. It is the product. The hero contains a live, interactive, trimmed version of the Unified Code View. The user proves GitLore works by using it, in the hero, before reading a single word of marketing copy.
Every technical decision in this document has a reason. Do not substitute generic patterns, default shadcn components, standard layouts, or anything you have seen on another landing page. If you would make this choice for any developer tool, it is the wrong choice.

Package Installation
bashnpm install gsap @gsap/react lenis animejs @uiwjs/react-codemirror @codemirror/lang-javascript @codemirror/lang-python
tsx// main.tsx — before rendering
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin);
tsx// App.tsx — Lenis initialization
import Lenis from 'lenis';

useEffect(() => {
  const lenis = new Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t))
  });
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  return () => lenis.destroy();
}, []);

Typography
css@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
FontWeightExact RoleSpace Grotesk700Hero headline only — one use, maximum impactSpace Grotesk600Section titles, card titles, stat numbersSpace Grotesk500Nav wordmark, button labelsInter400All body copy, descriptionsInter500Strong emphasis within body, labelsJetBrains Mono500/600Every number, every code string, every hash, every metric, timestamps, confidence badges
Critical tracking rules:

Space Grotesk 700 at display sizes: letter-spacing: -0.04em — it must be tight
Space Grotesk 600 at section title sizes: letter-spacing: -0.02em
JetBrains Mono everywhere: letter-spacing: 0.01em — slight open, never default
Inter body: letter-spacing: -0.01em, line-height: 1.75


Color System
Define exclusively as CSS custom properties on :root. Never use raw hex in component files.
css:root {
  /* Surfaces */
  --bg:              #0A0A0F;
  --surface:         #12121A;
  --surface-hover:   #1A1A25;
  --surface-active:  #1E1E2E;
  --elevated:        #16161F;

  /* Text */
  --text:            #E8E8ED;
  --text-secondary:  #8888A0;
  --text-ghost:      #4A4A60;
  --text-code:       #C8C8DD;

  /* Accent — electric purple */
  --accent:          #6C5CE7;
  --accent-hover:    #7C6CF7;
  --accent-dim:      rgba(108, 92, 231, 0.12);
  --accent-glow:     rgba(108, 92, 231, 0.20);

  /* Semantic */
  --success:         #2ECC71;
  --success-dim:     rgba(46, 204, 113, 0.12);
  --warning:         #F39C12;
  --warning-dim:     rgba(243, 156, 18, 0.12);
  --error:           #E74C3C;
  --error-dim:       rgba(231, 76, 60, 0.12);

  /* Code surfaces */
  --code-bg:         #0D0D14;
  --code-added:      rgba(46, 204, 113, 0.10);
  --code-removed:    rgba(231, 76, 60, 0.10);
  --code-highlight:  rgba(108, 92, 231, 0.15);

  /* Borders */
  --border:          rgba(255, 255, 255, 0.06);
  --border-strong:   rgba(255, 255, 255, 0.10);
  --border-accent:   rgba(108, 92, 231, 0.25);
}
Force dark mode on html. No toggle. No light variant.
Grain overlay:
cssbody::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  opacity: 0.020;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E");
}

Animation Library Separation — Non-Negotiable
WhatLibraryReasonHero timeline, section revealsGSAP + SplitTextSequencing complexityPanel slide-in (right panel)GSAP fromTo x: 100% → 0Precise easing controlScrollTrigger all scroll sequencesGSAPIrreplaceableSVG DrawSVG (timeline paths)GSAP DrawSVGPluginNow freeLenis tickGSAP tickerIntegration requirementComment badge pulseAnime.jsrepeat: -1, yoyo spring loopLine click glowAnime.jsbox-shadow keyframe animationSplit diff line revealsAnime.jsstagger({ grid })Confidence badge color cycleAnime.jsColor interpolationGuardrails flashAnime.jsbackground keyframeKnowledge graph node breathingAnime.jsSpring physics createSpringComparison counter (30→3)Anime.js onUpdateClean number update API
Never use both libraries on the same element. Never use Anime.js for scroll sequences.

Custom Cursor — Text Insertion Cursor
Not a dot. Not a ring. Not any cursor found on a dark SaaS or portfolio site.
A text insertion cursor — the blinking vertical bar | native to every code editor and terminal. GitLore is a tool you read and click code in. Its cursor should feel like it belongs in that environment.
css#cursor-i {
  position: fixed;
  width: 2px;
  height: 20px;
  background: var(--accent);
  border-radius: 1px;
  pointer-events: none;
  z-index: 9998;
  transform: translate(-50%, -50%);
}
Tracking via GSAP quickTo — near-zero lag:
tsconst xTo = gsap.quickTo('#cursor-i', 'x', { duration: 0.04 });
const yTo = gsap.quickTo('#cursor-i', 'y', { duration: 0.04 });
window.addEventListener('mousemove', e => { xTo(e.clientX); yTo(e.clientY); });
Blink — steps(1) not smooth fade, code cursors blink:
tsgsap.to('#cursor-i', {
  opacity: 0, repeat: -1, yoyo: true,
  duration: 0.53, ease: 'steps(1)'
});
```

**State changes:**

- Hover `button`, `a`, `[data-cursor="action"]`: width expands `2px → 12px`, height shrinks `20px → 12px`, `border-radius: 2px`. It becomes a rectangular block cursor — the cursor mode switches from "read" to "execute."
- Hover `[data-cursor="code"]` (code editor lines, line numbers): height extends `20px → 28px`, `background: var(--accent)` at full brightness. Taller insertion point signals "you can click here."
- Hover `[data-cursor="comment"]` (inline comment badges): cursor transforms to `width: 14px, height: 14px, border-radius: 50%` — a filled circle. Comments are a different interaction class.

Hide on mobile: `@media (hover: none) { #cursor-i { display: none; } }`. Set `cursor: default` on `html` for mobile, `cursor: none` for desktop.

---

## Navbar

`position: fixed`, `top: 0`, `left: 0`, `right: 0`, `height: 52px`, `z-index: 100`.

**Scroll states** via GSAP ScrollTrigger `start: "top -50px"`:
- At top: `background: transparent`, `border-bottom: 1px solid transparent`
- Scrolled: `background: rgba(10, 10, 15, 0.88)`, `backdrop-filter: blur(16px) saturate(1.4)`, `border-bottom: 1px solid var(--border)`

Transition: `0.4s cubic-bezier(0.16, 1, 0.3, 1)`.

**Layout — exactly four elements, no more:**
```
[LEFT]              [CENTER-LEFT]           [RIGHT-GROUP]
GitLore             /landing  →  /app       Guardrails    Connect Repo
Space Grotesk 500   Inter 400, 12px         ghost button  accent button
16px, --text        --text-ghost            
accent dot before   "Try the app →" link
Left — Wordmark:
A 6px circle in --accent with box-shadow: 0 0 8px var(--accent-glow) sits immediately left of "GitLore". This is the only decorative element. Space Grotesk 500, 16px, --text.
Center-left — breadcrumb trail:
"/landing" in Inter 400, 12px, --text-ghost. Then "→" in --text-ghost. Then "/app" as a link in Inter 400, 12px, --accent. This tells developers exactly where they are and where they can go. No hamburger menu, no dropdown.
Right group — two buttons, gap: 8px:
Guardrails: Space Grotesk 500, 13px, background: transparent, border: 1px solid var(--border), color: var(--text-secondary), height: 34px, border-radius: 6px, padding: 0 14px. On hover: border-color: var(--border-strong), color: var(--text). data-cursor="action".
Connect Repo: Space Grotesk 500, 13px, background: var(--accent), color: white, height: 34px, border-radius: 6px, padding: 0 16px. Hover via Anime.js spring:
tsimport { animate, createSpring } from 'animejs';
const sp = createSpring({ stiffness: 300, damping: 15 });
btn.addEventListener('mouseenter', () => animate(btn, { scale: 1.03, translateY: -1, duration: sp }));
btn.addEventListener('mouseleave', () => animate(btn, { scale: 1, translateY: 0, duration: sp }));
Mobile <768px: Hide center breadcrumb. Show wordmark left + "Connect" button right only.

Global Layout Rules

min-h-screen: Hero only. Every other section is content-height.
Section padding desktop: padding: 96px 0. Mobile: padding: 64px 0.
Container: max-width: 1100px; margin: 0 auto; padding: 0 24px; on desktop, padding: 0 20px on mobile.
No section eyebrows unless specified. Section titles speak for themselves.
margin-bottom: 12px maximum between consecutive inline text elements.
Sharp corners on all interactive elements. border-radius: 6px maximum. No rounded-full anywhere.
No gradients except the knowledge graph ambient glow. No shadows except code surface box-shadow.


Section 1: Hero — The Live Demo
min-h-screen, display: flex, flex-direction: column, justify-content: center, padding-top: 52px, position: relative, overflow: hidden.
This section is structured in two halves: copy above, live product demo below.
Background
An SVG of faint vertical lines at 80px intervals — position: absolute, inset: 0, z-index: 0, pointer-events: none. Via CSS: background: repeating-linear-gradient(to right, var(--border) 0px, transparent 1px, transparent 80px). opacity: 0.5. GSAP parallax on scroll: y: 0 → -30px via ScrollTrigger scrub. This gives depth without decoration.
Copy Half
Center-aligned, max-width: 680px, margin: 0 auto, z-index: 1.
GSAP master timeline on mount via useGSAP, fires after 200ms:

t=0: Tag line. "THE CONTEXT LAYER FOR CODE" — JetBrains Mono 500, 11px, --text-ghost, letter-spacing: 4px, uppercase. GSAP y: 8 → 0, opacity: 0 → 1, duration: 0.4s.
t=0.3s: Hero headline. SplitText type: "words" on:
"Click any line." — Space Grotesk 700, 72px (tablet: 52px, mobile: 36px), --text, letter-spacing: -0.04em, line-height: 0.95.
"Get the full story." — same style but color: var(--accent).
Each word: overflow: hidden wrapper, inner span y: 110% → 0, stagger 60ms, ease: power3.out, duration: 0.55s.
t=0.9s: Subheadline. "Every code review tool works for the reviewer. GitLore is the first tool built for the person receiving the review." — Inter 400, 18px (mobile: 15px), --text-secondary, max-width: 540px, line-height: 1.7, centered. GSAP y: 16 → 0, opacity: 0 → 1, duration: 0.5s.
t=1.3s: CTA row. Two buttons, display: flex, gap: 12px, justify-content: center, margin-top: 36px.
Primary "Connect GitHub Repo": Space Grotesk 500, 14px, background: var(--accent), color: white, height: 48px, border-radius: 6px, padding: 0 28px. Anime.js spring hover. Active scale(0.97).
Secondary "See how it works" (smooth-scrolls to demo section): same height, background: transparent, border: 1px solid var(--border-strong), color: var(--text-secondary). Hover: border-color: var(--accent), color: var(--text).
t=1.6s: Trust line. "Used by engineers at — " then three company names in Space Grotesk 500, 12px, --text-ghost. Center-aligned. Fade in 0.3s.
t=1.8s: The product demo slides up from y: 40 → 0, opacity: 0 → 1, duration: 0.7s, ease: power2.out.

Product Demo Half — THE KEY ELEMENT
margin-top: 48px. max-width: 960px. margin-left: auto. margin-right: auto. z-index: 1.
This is a real, interactive, trimmed instance of the GitLore UI. Not a screenshot. Not a div styled to look like code. A functional demo.
Outer frame:
background: var(--surface), border: 1px solid var(--border-strong), border-radius: 10px, overflow: hidden, box-shadow: 0 0 0 1px var(--border), 0 40px 80px rgba(0,0,0,0.5).
Titlebar height: 40px, background: var(--elevated), border-bottom: 1px solid var(--border), display: flex, align-items: center, justify-content: space-between, padding: 0 16px:

Left: Three 9px circles gap: 6px — #FF5F57, #FEBC2E, #28C840. Not interactive.
Center: "gitlore-demo-fintech / rate_limiter.py" — JetBrains Mono 400, 11px, --text-ghost.
Right: "PR #2 — Add rate limiting" — JetBrains Mono 400, 11px, --text-ghost.

Demo body display: grid, grid-template-columns: 1fr 380px (desktop). Single column on mobile with panel as bottom sheet.
Left — Code Editor:
Use @uiwjs/react-codemirror in READ ONLY mode. Language: @codemirror/lang-python. Theme: custom dark theme matching --code-bg. Font: JetBrains Mono 13px.
Show this exact code:
pythonimport time
from collections import defaultdict

class RateLimiter:
    def __init__(self, max_requests=100, window=60):
        self.requests = defaultdict(list)
        self.max_requests = max_requests
        self.window = window
    
    def is_allowed(self, client_id: str) -> bool:
        now = time.time()
        window_start = now - self.window
        
        # Clean expired requests
        self.requests[client_id] = [
            req for req in self.requests[client_id]
            if req > window_start
        ]
        
        if len(self.requests[client_id]) < self.max_requests:
            self.requests[client_id].append(now)
            return True
        return False
Line 5 (def __init__) has a clickable line number. data-cursor="code".
Inline comment badge after line 14 (if len(self.requests...)):
tsx<div className="inline-comment-badge" data-cursor="comment">
  <span className="badge-dot" />  {/* pulsing amber dot */}
  <span>memory: in-memory only</span>
  <span className="badge-author">@senior-dev</span>
</div>
Badge styles: background: var(--warning-dim), border: 1px solid var(--warning) at 0.3 opacity, border-radius: 4px, padding: 4px 10px, font-family: JetBrains Mono, font-size: 11px, color: var(--warning). margin-top: 4px, margin-left: 48px.
Anime.js pulse on badge — runs continuously:
tsimport { animate } from 'animejs';
animate('.badge-dot', {
  opacity: [1, 0.3],
  scale: [1, 0.8],
  duration: 1200,
  loop: true,
  easing: 'easeInOutSine',
  direction: 'alternate'
});
```

**Right — Context Panel** (initially shows empty state):

`background: var(--elevated)`, `border-left: 1px solid var(--border)`, `padding: 20px`, `display: flex`, `flex-direction: column`.

**Empty state** (shown initially):
```
[cursor icon — the same blinking | cursor, 24px, --accent]

Click a line number
to see why it exists.

Click a comment
to understand what it means.
Space Grotesk 500, 13px, --text-ghost, centered, margin: auto.
GSAP interaction — comment click:
When the inline comment badge is clicked:
ts// Step 1: highlight the line
gsap.to('.cm-line-14', {
  backgroundColor: 'var(--code-highlight)',
  duration: 0.3
});

// Step 2: panel slides in from right (if empty) or cross-fades
gsap.fromTo(panelContent, 
  { x: 24, opacity: 0 },
  { x: 0, opacity: 1, duration: 0.4, ease: 'power2.out' }
);
```

Panel content when comment clicked:
```
PATTERN DETECTED                    HIGH [confidence badge, green]
─────────────────────────────────────────────────
In-Memory State Not Persistent

[SplitDiffView — two columns]
LEFT (red bg):                     RIGHT (green bg):
self.requests = defaultdict(list)  # Use Redis for distributed support
                                   import redis
                                   self.redis = redis.Redis()

Why it matters:
This rate limiter resets on every deploy. In production
with multiple instances, each server has independent state.

Principle: Distributed State Management

Source: PR #2 review by @senior-dev  →  [opens GitHub]
SplitDiffView line reveals via Anime.js:
tsimport { animate, stagger } from 'animejs';
animate('.diff-line', {
  opacity: [0, 1],
  translateX: [-8, 0],
  duration: 200,
  delay: stagger(40),
  easing: 'easeOutQuart'
});
```

Confidence badge `"HIGH"` in green: Inter 500, `10px`, `background: var(--success-dim)`, `color: var(--success)`, `border: 1px solid var(--success)` at `0.3` opacity, `padding: 2px 8px`, `border-radius: 3px`. Anime.js color pulse loop via `opacity: [1, 0.6]`, `repeat: -1`, `yoyo: true`, `duration: 2000`.

**GSAP interaction — line number click (line 5):**

Panel cross-fades to narrative view:
```
DECISION NARRATIVE                  HIGH [green badge]
─────────────────────────────────────────────────────
Rate limiting added after DDoS incident in March 2022

[StoryTimeline SVG — 4 nodes connected by a DrawSVG path]
● Issue #820   →   ● PR #2   →   ● Review   →   ● Merged
  503 errors        Add rate         Debate:       March 15
                    limiting         Redis vs       2022
                                    in-memory

Debate (from PR #2):
@teammate-a "Why not Redis? We need distributed support."
@teammate-b "DevOps can't provision Redis before Friday."

Decision: In-memory chosen for speed. Tech debt noted.
Impact: 503 error rate dropped from 12% to 0.1%.

Sources: 1 issue · 1 PR · 3 review comments
StoryTimeline SVG: GSAP DrawSVGPlugin draws the connecting path from left to right over 1s when panel opens, ease: power2.inOut. Each node ● appears with scale: 0 → 1, ease: back.out(1.5), stagger 0.2s.
Auto-loop behavior:
If no user interaction for 6s, the demo auto-cycles: starts with empty state → animates comment click → shows explanation panel → after 4s, animates line click → shows narrative → after 4s, resets. GSAP timeline with repeat: -1. On any user interaction, pause the auto-cycle.
Mobile panel: On <768px, the right panel becomes a bottom sheet. position: fixed, bottom: 0, left: 0, right: 0, max-height: 60vh, border-radius: 16px 16px 0 0, z-index: 50. Drag handle at top: width: 40px, height: 4px, border-radius: 2px, background: var(--border-strong), centered. Slides up via GSAP y: '100%' → 0, duration: 0.4s, ease: power3.out.

Section 2: Stats Bar
height: 56px, background: var(--surface), border-top: 1px solid var(--border), border-bottom: 1px solid var(--border), overflow: hidden.
Three stats in a row on desktop, auto-scrolling marquee on mobile.
Desktop: display: flex, align-items: center, justify-content: center, gap: 0. Each stat padding: 0 48px, border-right: 1px solid var(--border). Last one: no border.
Each stat: display: flex, align-items: center, gap: 12px.

Number: Space Grotesk 600, 18px, --accent. All in JetBrains Mono actually — these are metrics.
Label: Inter 400, 13px, --text-secondary.

Three stats:

"20" anti-patterns pre-loaded
"3 sec" average context assembly
"0" competitors built for review receivers

Anime.js count-up on each number when section enters viewport via GSAP ScrollTrigger onEnter. Duration 800ms, easing: easeOutExpo.
Mobile: GSAP marquee repeat: -1, duration: 25s, ease: none.

Section 3: Pain Statement
padding: 96px 0. Centered. max-width: 760px, margin: 0 auto, text-align: center.
No card. No background. No icon. Typography only.
Line 1: "You get a code review." — Space Grotesk 600, 32px (mobile: 22px), --text, line-height: 1.
Line 2: "It says 'memory leak.' Two words." — same but Space Grotesk 700, 48px (mobile: 30px), color: var(--error), line-height: 1, margin-top: 8px.
Line 3: "No explanation. No context. No fix." — Inter 400, 18px, --text-secondary, margin-top: 20px.
A thin 1px horizontal line width: 64px, background: var(--border-strong), margin: 28px auto.
Line 4: "You spend 30 minutes Googling, copy-pasting into ChatGPT, or pinging your senior on Slack." — Inter 400, 17px, --text-secondary, line-height: 1.75.
Line 5: "GitLore does it in one click." — Space Grotesk 600, 24px, color: var(--accent), margin-top: 20px.
GSAP ScrollTrigger start: "top 75%". SplitText type: "lines" on all text. Lines reveal y: 20 → 0, opacity: 0 → 1, stagger 0.12s, ease: power2.out.

Section 4: Feature Bento Grid
padding: 96px 0.
Section label above grid: "WHAT GITLORE DOES" — JetBrains Mono 400, 10px, --text-ghost, uppercase, letter-spacing: 3px, text-align: center, margin-bottom: 32px.
Grid: display: grid, grid-template-columns: 1fr 1fr desktop, 1fr mobile. grid-template-rows: auto auto. gap: 1px. background: var(--border). border: 1px solid var(--border). border-radius: 10px. overflow: hidden.
First card spans both columns (grid-column: span 2 desktop).
All cards: background: var(--surface), padding: 28px 28px 24px. NO border-radius on cards — the grid overflow: hidden clips everything.
Card 1 (large, full-width): Review Explainer
Top section margin-bottom: 20px: Title "Review Explainer" Space Grotesk 600, 20px, --text. Subtitle "Click any review comment. Get the explanation, the fix, and the principle — with source links to the original PR discussion." Inter 400, 14px, --text-secondary, line-height: 1.65, max-width: 520px.
Bottom section: A CSS recreation of the SplitDiffView — two columns side by side, display: grid, grid-template-columns: 1fr 1fr, gap: 1px, background: var(--border), border: 1px solid var(--border), border-radius: 6px, overflow: hidden, font-family: JetBrains Mono, font-size: 12px.
Left column background: var(--code-removed): 4 lines of red-tinted code, each padding: 4px 12px. Content: the buggy useEffect code.
Right column background: var(--code-added): 4 lines of green-tinted code. Content: the fixed version with cleanup.
Anime.js on scroll onEnter: left lines reveal top-to-bottom opacity: 0 → 1, translateX: -6 → 0, stagger 60ms. Right lines same but translateX: 6 → 0.
Card 2 (small): Code Archaeology
Title: "Code Archaeology". Subtitle: "Click any line. See why it exists — the full decision story from git history."
Visual: A stripped-down StoryTimeline — 4 nodes ● connected by a 2px horizontal line. GSAP DrawSVGPlugin draws the line from left to right when card enters viewport. Nodes pop in sequentially scale: 0 → 1, ease: back.out(1.5).
Node labels below: JetBrains Mono 400, 9px, --text-ghost: "Issue", "PR", "Review", "Merge".
Card 3 (small): Pattern Library
Title: "Pattern Library". Subtitle: "20 pre-loaded anti-patterns. Memory leaks, N+1 queries, XSS, SQL injection — matched automatically."
Visual: A 4×5 grid of 24px squares. Each square is background: var(--surface-active), border: 1px solid var(--border), border-radius: 3px. On scroll entry, 5 squares light up with background: var(--accent-dim), border-color: var(--accent), staggered via Anime.js stagger({ grid: [4, 5], from: 'first' }), duration: 200, delay: stagger(60). The 5 lit squares represent detected patterns.

Section 5: Comparison
padding: 96px 0. background: var(--surface). border-top: 1px solid var(--border). border-bottom: 1px solid var(--border).
Two columns: display: grid, grid-template-columns: 1fr 1px 1fr desktop, 1fr mobile. gap: 0. max-width: 900px, margin: 0 auto.
The 1px column: background: var(--border), align-self: stretch.
Left column padding: 0 48px 0 0:
Label: "WITHOUT GITLORE" — JetBrains Mono 400, 10px, --text-ghost, uppercase, letter-spacing: 3px.
Big number: The animated countdown clock. Starts at "30:00" and counts DOWN to "00:03" over 2.5s via Anime.js onUpdate, triggered on scroll entry. Space Grotesk 700, 64px (mobile: 44px), color: var(--error), font-feature-settings: "tnum" (tabular numbers so digits don't shift). JetBrains Mono actually for the number — font-family: JetBrains Mono, font-size: 64px, font-weight: 700.
tsimport { animate } from 'animejs';
const obj = { val: 1800 }; // 30 minutes in seconds
animate(obj, {
  val: 3,
  duration: 2500,
  easing: 'easeInOutExpo',
  onUpdate: () => {
    const m = Math.floor(obj.val / 60).toString().padStart(2, '0');
    const s = Math.floor(obj.val % 60).toString().padStart(2, '0');
    el.textContent = `${m}:${s}`;
  }
});
```

Below the number: A vertical step list. Each step: Inter 400, `14px`, `--text-secondary`. Steps separated by `↓` in `--text-ghost`. Steps fade in sequentially, 150ms stagger, after the countdown completes.
```
Google the error
↓
Read Stack Overflow
↓
Copy code to ChatGPT
↓
Ask senior on Slack
↓
Wait for response
Right column padding: 0 0 0 48px:
Label: "WITH GITLORE" — same label style but color: var(--accent).
Big number: "00:03" — JetBrains Mono 700, 64px, color: var(--success). Appears with a single scale: 0.8 → 1, opacity: 0 → 1, duration: 0.4s pop after the countdown completes.
Below: Inter 400, 14px, --text:
"Click the comment → Done."
Then a single line: Inter 400, 13px, --text-secondary, margin-top: 16px:
"Context assembled automatically from GitHub's API. No copy-paste. No tab switching."

Section 6: How It Works
padding: 96px 0.
Section label: "THREE STEPS" — JetBrains Mono 400, 10px, --text-ghost, uppercase, letter-spacing: 3px, centered, margin-bottom: 48px.
Title: "From zero to context in one click." — Space Grotesk 600, 32px (mobile: 24px), --text, centered, margin-bottom: 56px.
Three-column horizontal layout desktop, vertical stack mobile. display: grid, grid-template-columns: 1fr 1fr 1fr desktop. gap: 0. Columns share 1px right borders.
Each step padding: 0 40px:
Step number: JetBrains Mono 600, 12px, --accent, letter-spacing: 2px. Format: "01", "02", "03".
Step title: Space Grotesk 600, 22px, --text, margin-top: 8px, line-height: 1.1.
Step body: Inter 400, 14px, --text-secondary, line-height: 1.7, margin-top: 10px.
Step visual — a minimal code-native visual, margin-top: 20px:
Step 01 — "Connect your repo":
A simplified GitHub OAuth button mock — background: var(--surface-active), border: 1px solid var(--border-strong), border-radius: 6px, padding: 10px 14px, display: flex, align-items: center, gap: 10px. Left: a 20px GitHub-mark SVG (simple path, hand-drawn in code — the GitHub octocat mark as SVG paths). Right: JetBrains Mono 500, 12px, --text: "github.com/your-repo".
Step 02 — "Click anything":
A simplified code line mock — two lines of code in JetBrains Mono 12px, --text-code. Line 5 highlighted with background: var(--code-highlight). Line number 5 in --accent. A data-cursor="code" label below: "← click any line" in JetBrains Mono 400, 10px, --text-ghost.
Step 03 — "Get the story":
A minimal narrative panel preview — background: var(--elevated), border: 1px solid var(--border), border-radius: 6px, padding: 12px 14px. A "HIGH" confidence badge top-right. Two lines of text in Inter 400, 12px, --text-secondary representing truncated narrative. A "→ PR #847" source link in JetBrains Mono 400, 11px, --accent.
GSAP ScrollTrigger: each column y: 20 → 0, opacity: 0 → 1, stagger 0.15s, start: "top 78%".

Section 7: Codebase Knowledge Graph
padding: 96px 0.
Section label: "REPO INTELLIGENCE" — same label style, centered, margin-bottom: 24px.
Title: "See your codebase as a knowledge graph." — Space Grotesk 600, 32px, --text, centered.
Subtitle: "Hotspots, patterns, and decision trails — all connected. Every node is a file. Every edge is a shared PR." — Inter 400, 16px, --text-secondary, max-width: 560px, centered, margin: 12px auto 48px.
The graph: A <canvas> element, width: 100%, height: 420px (mobile: 280px). Implement a force-directed graph using plain Canvas 2D — NO d3, NO react-flow (too heavy for a landing page).
The canvas renders ~25 nodes representing files. Position via simple force simulation — each node has vx, vy velocity and x, y position. On each requestAnimationFrame:

Apply repulsion between all node pairs
Apply attraction along edges
Apply center gravity
Dampen velocities
Draw

Node rendering:

radius: 6px base, scaled by Math.random() * 6 + 4 to simulate change frequency
Color: green "#2ECC71" for clean files (80%), amber "#F39C12" for files with patterns (15%), red "#E74C3C" for hotspots (5%)
Glow: ctx.shadowBlur = 8; ctx.shadowColor = nodeColor before drawing

Edge rendering:

strokeStyle: rgba(255, 255, 255, 0.06), lineWidth: 1
Edges pulse via Anime.js controlling an edgeOpacity value 0.03 → 0.10, repeat: -1, yoyo: true, duration: 3000, easing: easeInOutSine

Node breathing via Anime.js:
tsimport { animate, createSpring } from 'animejs';
nodes.forEach((node, i) => {
  animate({ r: node.radius }, {
    r: node.radius * 1.15,
    loop: true,
    direction: 'alternate',
    duration: 2000 + i * 200,  // offset each node
    easing: 'easeInOutSine',
    onUpdate: (a) => { node.displayRadius = a.targets[0].r; }
  });
});
Hovering over a node shows a tooltip: background: var(--surface), border: 1px solid var(--border-strong), border-radius: 6px, padding: 8px 12px. JetBrains Mono 400, 11px, --text. Content: "auth_service.py — 47 changes · 4 authors".
The canvas activates (starts the force simulation) when section enters viewport via GSAP ScrollTrigger onEnter. Before that: static. Pauses via cancelAnimationFrame when section leaves.
aria-label="Codebase knowledge graph — interactive visualization of file relationships" on the canvas.

Section 8: Final CTA
min-height: 50vh, display: flex, flex-direction: column, justify-content: center, align-items: center, text-align: center, position: relative.
Background: radial-gradient(ellipse 60% 50% at 50% 50%, rgba(108, 92, 231, 0.06) 0%, transparent 70%).
Two lines:
"Your code has stories." — Space Grotesk 700, 52px (mobile: 32px), --text, letter-spacing: -0.03em, line-height: 0.95. GSAP y: 24 → 0, opacity: 0 → 1 on scroll enter.
"Start reading them." — same style but color: var(--accent). Delay 0.1s.
CTA button margin-top: 40px: "Connect GitHub Repo". Same primary button style from hero. Anime.js spring hover.
Below button margin-top: 14px: Inter 400, 12px, --text-ghost:
"Free to use · Works on any public repo · No installation required"

Footer
Two rows. Not a single line. Not columns.
Row 1 padding: 24px 0 14px, border-top: 1px solid var(--border), display: flex, justify-content: space-between, align-items: center:

Left: "GitLore" Space Grotesk 500, 14px, --text-ghost. The same 6px accent dot before it.
Center: "Built at HackByte 4.0 · IIITDM Jabalpur · April 2026" — JetBrains Mono 400, 11px, --text-ghost.
Right: "GitHub" and "Docs" in Inter 400, 12px, --text-ghost. gap: 20px.

Row 2 padding: 0 0 24px, centered:
A disclaimer strip: display: inline-block, border: 1px solid var(--border), border-radius: 5px, padding: 8px 16px, background: var(--surface):
"GitLore reads your repository using the GitHub API. Code never leaves GitHub's infrastructure. No training data collected." — Inter 400, 10px, --text-ghost, line-height: 1.65.
No social icons. No newsletter. No sitemap. No nav links in footer.

Responsive Breakpoints
ViewportKey Changes>1024pxFull layout: side-by-side hero demo, 2-col bento large card, 3-col how it works, 2-col comparison768–1024pxHero demo editor + panel stack vertically; bento large card single-col; 2-col how it works<768pxDemo panel as bottom sheet; all grids single column; cursor hidden; navbar center hidden; knowledge graph height 280px

Anti-Slop Rules
❌ No gradient hero with purple mesh or blue glow
❌ No glassmorphism cards
❌ No bento grid with generic icons (cards must show product UI)
❌ No numbered circle steps with shadows
❌ No avatar testimonials or star ratings
❌ No dot-plus-ring cursor
❌ No rounded-full on any interactive element
❌ No Poppins, Montserrat, Space Grotesk at thin weights for body text
❌ No shadcn Card, Button, Badge, or any component library component
❌ No Framer Motion — GSAP and Anime.js only
❌ No particle background, dot grid, or animated gradient mesh
❌ No generic SVG illustrations of rockets, brains, or lightbulbs
❌ No static screenshot of the product in the hero — the demo must be interactive
❌ No padding larger than 96px 0 on any section
❌ No text-gradient CSS tricks
❌ No "Seamless / Supercharge / Unleash / Next-Gen / Revolutionary"
❌ No four-column footer
❌ No identical animation on every section