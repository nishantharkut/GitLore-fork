import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { buildCmTheme, cmLanguageForPath, EditorView } from "@/lib/codemirrorAppTheme";

export type AppViewCodeEditorProps = {
  value: string;
  filePath: string;
  isMobile: boolean;
  mobileCodeWrap: boolean;
  fileLoading: boolean;
  selectedLine: number | null;
  onLineActivate: (line: number) => void;
};

export default function AppViewCodeEditor({
  value,
  filePath,
  isMobile,
  mobileCodeWrap,
  fileLoading,
  selectedLine,
  onLineActivate,
}: AppViewCodeEditorProps) {
  const cmTheme = useMemo(() => buildCmTheme(isMobile, mobileCodeWrap), [isMobile, mobileCodeWrap]);
  const cmExtensions = useMemo(
    () => [
      cmLanguageForPath(filePath || ""),
      ...(isMobile && mobileCodeWrap ? [EditorView.lineWrapping] : []),
    ],
    [filePath, isMobile, mobileCodeWrap]
  );

  return (
    <div className="relative min-h-0 min-w-0 flex-1 [&_.cm-editor]:h-full [&_.cm-editor]:min-w-0">
      {fileLoading && (
        <div
          className="absolute right-2 top-2 z-10 flex items-center gap-2 rounded border border-gitlore-border/80 bg-gitlore-surface/95 px-2 py-1 font-code text-[10px] text-gitlore-text-secondary shadow-sm backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <span
            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-gitlore-border border-t-gitlore-accent"
            aria-hidden
          />
          Loading file…
        </div>
      )}
      <CodeMirror
        value={value}
        key={`${filePath}-${isMobile ? `m-${mobileCodeWrap ? "wrap" : "nowrap"}` : "d"}`}
        extensions={cmExtensions}
        theme={cmTheme}
        editable={false}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, highlightActiveLineGutter: true }}
        onStatistics={(stats) => {
          const line = stats.line.number;
          if (line !== selectedLine) onLineActivate(line);
        }}
        className="h-full min-h-[18rem] md:min-h-0"
      />
    </div>
  );
}
