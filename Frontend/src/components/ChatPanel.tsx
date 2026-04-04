import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  Children,
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import { Send, Bot, User, ExternalLink, Loader, Sparkles, Mic } from "lucide-react";
import { useRepo } from "@/context/RepoContext";
import { useTheme } from "@/context/ThemeContext";
import {
  postJSON,
  fetchChatGraphStatus,
  fetchChatSuggestions,
  type ChatGraphStatusResponse,
} from "@/lib/gitloreApi";
import { ChatMermaidBlock } from "@/components/ChatMermaidBlock";
import {
  browserSpeechRecognitionSupported,
  recognizeSpeechOnce,
} from "@/lib/browserSpeechRecognition";

/** Plain-text PR / issue refs → markdown links for the active repo. */
function linkifyRepoReferences(markdown: string, owner: string, name: string): string {
  const o = encodeURIComponent(owner);
  const n = encodeURIComponent(name);
  const base = `https://github.com/${o}/${n}`;
  let s = markdown.replace(/\bPR\s*#(\d+)\b/gi, (_m, num: string) => `[PR #${num}](${base}/pull/${num})`);
  s = s.replace(/\bissue\s*#(\d+)\b/gi, (_m, num: string) => `[Issue #${num}](${base}/issues/${num})`);
  return s;
}

interface Source {
  pr_number: number;
  pr_url: string;
  title: string;
  type: string;
  score?: number;
}

type SynthesisKind = "none" | "gemini" | "fallback_no_key" | "fallback_error";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  searchTier?: string;
  nodesUsed?: number;
  synthesis?: SynthesisKind;
  model?: string;
}

const TYPE_COLORS: Record<string, string> = {
  feature: "text-blue-400",
  bugfix: "text-red-400",
  refactor: "text-green-400",
  architecture: "text-purple-400",
  security: "text-orange-400",
  performance: "text-yellow-400",
  documentation: "text-gray-400",
  other: "text-gray-500",
};

type ChatPanelProps = { initialQuestion?: string };

export function ChatPanel({ initialQuestion }: ChatPanelProps) {
  const { target, repoReady } = useRepo();
  const { theme } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState<ChatGraphStatusResponse | null>(null);
  const [starterChips, setStarterChips] = useState<string[]>([]);
  const [micBusy, setMicBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chipsScrollRef = useRef<HTMLDivElement>(null);
  const appliedPrefill = useRef<string | null>(null);
  const speechOk = browserSpeechRecognitionSupported();

  const assistantMarkdownComponents = useMemo(
    () => ({
      h1: (props: ComponentPropsWithoutRef<"h1">) => (
        <h1 className="mb-2 mt-3 text-base font-semibold text-gitlore-text first:mt-0" {...props} />
      ),
      h2: (props: ComponentPropsWithoutRef<"h2">) => (
        <h2 className="mb-2 mt-3 text-[15px] font-semibold text-gitlore-text first:mt-0" {...props} />
      ),
      h3: (props: ComponentPropsWithoutRef<"h3">) => (
        <h3 className="mb-1.5 mt-2 text-sm font-semibold text-gitlore-text first:mt-0" {...props} />
      ),
      p: (props: ComponentPropsWithoutRef<"p">) => (
        <p className="mb-2 last:mb-0 leading-relaxed text-gitlore-text" {...props} />
      ),
      ul: (props: ComponentPropsWithoutRef<"ul">) => (
        <ul className="mb-2 list-inside list-disc space-y-1 pl-0.5 text-gitlore-text marker:text-gitlore-text-secondary" {...props} />
      ),
      ol: (props: ComponentPropsWithoutRef<"ol">) => (
        <ol className="mb-2 list-inside list-decimal space-y-1 pl-0.5 text-gitlore-text marker:text-gitlore-text-secondary" {...props} />
      ),
      li: (props: ComponentPropsWithoutRef<"li">) => <li className="leading-relaxed [&>p]:mb-0" {...props} />,
      strong: (props: ComponentPropsWithoutRef<"strong">) => (
        <strong className="font-semibold text-gitlore-text" {...props} />
      ),
      em: (props: ComponentPropsWithoutRef<"em">) => <em className="italic text-gitlore-text" {...props} />,
      a: (props: ComponentPropsWithoutRef<"a">) => (
        <a
          className="text-gitlore-accent underline decoration-gitlore-accent/40 underline-offset-2 transition-colors hover:text-gitlore-accent-hover"
          target="_blank"
          rel="noopener noreferrer"
          {...props}
        />
      ),
      code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code">) => {
        const lang = /language-(\w+)/.exec(className || "")?.[1];
        const text = String(children).replace(/\n$/, "");
        if (lang === "mermaid") {
          return <ChatMermaidBlock chart={text} theme={theme} />;
        }
        const isBlock = /language-/.test(className || "");
        if (isBlock) {
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        }
        return (
          <code
            className="rounded-sm bg-gitlore-code px-1.5 py-0.5 font-code text-[13px] text-gitlore-accent"
            {...props}
          >
            {children}
          </code>
        );
      },
      pre: ({ children }: { children?: ReactNode }) => {
        try {
          const only = Children.only(children) as ReactElement<{ className?: string }>;
          if (isValidElement(only) && /language-mermaid/.test(String(only.props.className || ""))) {
            return <div className="min-w-0">{children}</div>;
          }
        } catch {
          /* multiple children — use default pre */
        }
        return (
          <pre className="mb-2 max-w-full overflow-x-auto rounded-sm border border-gitlore-border bg-gitlore-code p-3 font-code text-[13px] leading-relaxed text-gitlore-text">
            {children}
          </pre>
        );
      },
      blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
        <blockquote className="mb-2 border-l-2 border-gitlore-border pl-3 text-gitlore-text-secondary italic" {...props} />
      ),
      hr: () => <hr className="my-3 border-gitlore-border" />,
    }),
    [theme]
  );

  useEffect(() => {
    if (!repoReady) {
      setChatStatus(null);
      return;
    }
    let cancelled = false;
    void fetchChatGraphStatus(target.owner, target.name)
      .then((s) => {
        if (!cancelled) setChatStatus(s);
      })
      .catch(() => {
        if (!cancelled) setChatStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [repoReady, target.owner, target.name]);

  useEffect(() => {
    if (!repoReady) {
      setStarterChips([]);
      return;
    }
    let cancelled = false;
    void fetchChatSuggestions(target.owner, target.name)
      .then((rows) => {
        if (!cancelled) setStarterChips(rows);
      })
      .catch(() => {
        if (!cancelled) setStarterChips([]);
      });
    return () => {
      cancelled = true;
    };
  }, [repoReady, target.owner, target.name]);

  useEffect(() => {
    const q = initialQuestion?.trim();
    if (!q || appliedPrefill.current === q) return;
    appliedPrefill.current = q;
    setInput(q);
  }, [initialQuestion]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, loading]);

  const followUpChips = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant" || !m.sources?.length) continue;
      const pr = m.sources[0].pr_number;
      return [
        `What problem did PR #${pr} solve, and what alternatives were considered?`,
        `Who showed up in review discussion on PR #${pr}, and what did they argue?`,
      ];
    }
    return [];
  }, [messages]);

  const showStarterRow = messages.length === 0 && starterChips.length > 0;
  const showFollowUpRow = messages.length > 0 && followUpChips.length > 0 && !loading;

  useEffect(() => {
    const el = chipsScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 2) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [showStarterRow, showFollowUpRow, starterChips.length, followUpChips.length]);

  const handleSend = useCallback(
    async (override?: string) => {
      const q = (override ?? input).trim();
      if (!q || loading || !repoReady) return;
      if (q.length < 5) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "Please ask a slightly longer question (at least 5 characters) so the graph search can match meaningfully.",
          },
        ]);
        return;
      }

      const historyPayload = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
        .slice(-14);

      if (!override) setInput("");
      setMessages((prev) => [...prev, { role: "user", content: q }]);
      setLoading(true);

      try {
        const res = (await postJSON(`/api/repo/${target.owner}/${target.name}/chat`, {
          question: q,
          ...(historyPayload.length ? { history: historyPayload } : {}),
        })) as {
          answer: string;
          sources?: Source[];
          searchTier?: string;
          nodesUsed?: number;
          synthesis?: SynthesisKind;
          model?: string;
          geminiConfigured?: boolean;
        };
        if (typeof res.geminiConfigured === "boolean") {
          setChatStatus((prev) => ({
            geminiConfigured: res.geminiConfigured!,
            model: res.model || prev?.model || "gemini-2.5-flash-lite",
          }));
        }
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.answer,
            sources: res.sources,
            searchTier: res.searchTier,
            nodesUsed: res.nodesUsed,
            synthesis: res.synthesis,
            model: res.model,
          },
        ]);
      } catch (err) {
        const msg =
          err instanceof Error && /invalid question|5.*2000/i.test(err.message)
            ? "Use between 5 and 2000 characters for your question."
            : "Sorry, something went wrong. Try again.";
        setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
        console.error("Chat error:", err);
      } finally {
        setLoading(false);
      }
    },
    [input, loading, repoReady, target.owner, target.name, messages]
  );

  return (
    <div className="flex h-[min(540px,62vh)] min-h-[440px] shrink-0 flex-col rounded-sm border border-gitlore-border bg-gitlore-surface">
      <div className="shrink-0 border-b border-gitlore-border px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gitlore-text">Chat with the knowledge graph</h3>
          {chatStatus ? (
            <span
              className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-code text-[10px] ${
                chatStatus.geminiConfigured
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-200"
              }`}
              title="Configured on the GitLore Backend (.env), not in the browser"
            >
              <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
              {chatStatus.geminiConfigured ? `Gemini: ${chatStatus.model}` : "Add GEMINI_API_KEY to Backend .env"}
            </span>
          ) : null}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-4">
        {messages.length === 0 && (
          <div className="py-6 text-center text-sm leading-relaxed text-gitlore-text-secondary">
            Try: &ldquo;Why did we change authentication?&rdquo;, &ldquo;Who drove the API refactors?&rdquo;, or &ldquo;Show how
            these PRs relate to issue #12.&rdquo;
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && (
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gitlore-accent/20">
                <Bot className="h-4 w-4 text-gitlore-accent" />
              </div>
            )}
            <div
              className={`max-w-[88%] rounded-sm px-3 py-2.5 text-sm ${
                msg.role === "user"
                  ? "bg-gitlore-accent/15 text-gitlore-text"
                  : "bg-gitlore-code text-gitlore-text"
              }`}
            >
              {msg.role === "user" ? (
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              ) : (
                <div className="min-w-0 break-words">
                  <ReactMarkdown components={assistantMarkdownComponents}>
                    {linkifyRepoReferences(msg.content, target.owner, target.name)}
                  </ReactMarkdown>
                </div>
              )}
              {msg.role === "assistant" &&
                (msg.searchTier ||
                  msg.nodesUsed != null ||
                  (msg.synthesis && msg.synthesis !== "none")) && (
                  <p className="mt-2 border-t border-gitlore-border/50 pt-2 font-code text-[10px] text-gitlore-text-secondary">
                    {msg.synthesis && msg.synthesis !== "none" && (
                      <span className="mr-2">
                        {msg.synthesis === "gemini" && (
                          <span className="text-emerald-400/90">
                            Synthesis: Gemini{msg.model ? ` (${msg.model})` : ""}
                          </span>
                        )}
                        {msg.synthesis === "fallback_no_key" && (
                          <span className="text-amber-400/90">Synthesis: offline (no API key)</span>
                        )}
                        {msg.synthesis === "fallback_error" && (
                          <span className="text-red-400/90">Synthesis: Gemini error — raw matches shown</span>
                        )}
                      </span>
                    )}
                    {msg.searchTier && msg.searchTier !== "none" && (
                      <span>
                        Search: <span className="text-gitlore-accent">{msg.searchTier}</span>
                      </span>
                    )}
                    {msg.nodesUsed != null && (
                      <span className={msg.searchTier && msg.searchTier !== "none" ? " · " : ""}>
                        Nodes used: {msg.nodesUsed}
                      </span>
                    )}
                  </p>
                )}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 border-t border-gitlore-border/60 pt-2">
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-gitlore-text-secondary">
                    Sources
                  </p>
                  <ul className="space-y-1">
                    {msg.sources.map((s) => (
                      <li key={s.pr_number}>
                        <a
                          href={s.pr_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 break-words text-xs text-gitlore-accent transition-colors hover:text-gitlore-accent-hover"
                        >
                          <span className={TYPE_COLORS[s.type] || "text-gray-400"}>[{s.type}]</span>
                          <span>
                            PR #{s.pr_number}: {s.title.length > 42 ? `${s.title.slice(0, 40)}…` : s.title}
                          </span>
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {msg.role === "user" && (
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gitlore-surface">
                <User className="h-4 w-4 text-gitlore-text-secondary" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gitlore-accent/20">
              <Loader className="h-4 w-4 animate-spin text-gitlore-accent" />
            </div>
            <div className="rounded-sm bg-gitlore-code px-3 py-2 text-sm text-gitlore-text-secondary">
              Searching knowledge nodes and synthesizing…
            </div>
          </div>
        )}
      </div>

      {(showStarterRow || showFollowUpRow) && (
        <div
          ref={chipsScrollRef}
          className="flex shrink-0 flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden border-t border-gitlore-border px-3 py-2 [scrollbar-width:thin] hover:cursor-default"
          aria-label="Suggested questions — scroll horizontally or use the mouse wheel"
        >
          {showStarterRow && (
            <>
              <span className="shrink-0 select-none text-[10px] font-medium uppercase tracking-wider text-gitlore-text-secondary">
                Suggested
              </span>
              {starterChips.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={loading || !repoReady}
                  title={t}
                  onClick={() => void handleSend(t)}
                  className="shrink-0 max-w-[min(20rem,calc(100vw-5rem))] truncate rounded-full border border-gitlore-border/80 bg-gitlore-code/40 px-3 py-1.5 text-left text-[11px] text-gitlore-text transition-colors hover:border-gitlore-accent/50 hover:bg-gitlore-code disabled:opacity-50"
                >
                  {t}
                </button>
              ))}
            </>
          )}
          {showFollowUpRow && (
            <>
              <span className="shrink-0 select-none text-[10px] font-medium uppercase tracking-wider text-gitlore-text-secondary">
                Follow up
              </span>
              {followUpChips.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={loading || !repoReady}
                  title={t}
                  onClick={() => void handleSend(t)}
                  className="shrink-0 max-w-[min(20rem,calc(100vw-5rem))] truncate rounded-full border border-gitlore-border/80 bg-gitlore-code/40 px-3 py-1.5 text-left text-[11px] text-gitlore-text transition-colors hover:border-gitlore-accent/50 hover:bg-gitlore-code disabled:opacity-50"
                >
                  {t}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <div className="shrink-0 border-t border-gitlore-border p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void handleSend()}
            placeholder="Ask about decisions in this repo…"
            disabled={loading || !repoReady || micBusy}
            className="min-w-0 flex-1 rounded-sm border border-gitlore-border bg-gitlore-code px-3 py-2 text-sm text-gitlore-text placeholder:text-gitlore-text-secondary/50 focus:border-gitlore-accent focus:outline-none"
          />
          {speechOk ? (
            <button
              type="button"
              title="Dictate question (browser speech)"
              disabled={loading || !repoReady || micBusy}
              onClick={() => {
                setMicBusy(true);
                void recognizeSpeechOnce(typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US")
                  .then((text) => {
                    const t = text.trim();
                    if (t) setInput((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t));
                  })
                  .catch((e) => {
                    console.error(e);
                    setMessages((prev) => [
                      ...prev,
                      {
                        role: "assistant",
                        content: e instanceof Error ? e.message : "Speech input failed.",
                      },
                    ]);
                  })
                  .finally(() => setMicBusy(false));
              }}
              className="shrink-0 rounded-sm border border-gitlore-border bg-gitlore-code px-3 py-2 text-gitlore-accent transition-colors hover:bg-gitlore-surface-hover disabled:opacity-50"
            >
              <Mic className={`h-4 w-4 ${micBusy ? "animate-pulse" : ""}`} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={loading || !input.trim() || !repoReady || micBusy}
            className="shrink-0 rounded-sm bg-gitlore-accent px-3 py-2 text-white transition-colors hover:bg-gitlore-accent-hover disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
