import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorSelection } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { EditorView as CMEditorView } from "@codemirror/view";
import { cmExtensionsForPath, EditorView } from "@/lib/codemirrorAppTheme";
import { useTheme } from "@/context/ThemeContext";

export type AppViewCodeEditorProps = {
  value: string;
  filePath: string;
  isMobile: boolean;
  /** When true, enable soft line wrapping (desktop and mobile). */
  codeWrap: boolean;
  fileLoading: boolean;
  selectedLine: number | null;
  onLineActivate: (line: number) => void;
  /** Extra CodeMirror extensions (e.g. inline comment widgets). Single Extension or array — both are supported. */
  extraExtensions?: Extension | Extension[];
  /** When false, line number clicks do not call onLineActivate (Review Comments mode). */
  enableLineHistory?: boolean;
  /** 1-based line to scroll into view after content loads (e.g. PR navigation). Cleared via onScrolledToLine. */
  scrollToLine?: number | null;
  onScrolledToLine?: () => void;
};

export default function AppViewCodeEditor({
  value,
  filePath,
  isMobile,
  codeWrap,
  fileLoading,
  selectedLine,
  onLineActivate,
  extraExtensions,
  enableLineHistory = true,
  scrollToLine = null,
  onScrolledToLine,
}: AppViewCodeEditorProps) {
  const editorViewRef = useRef<CMEditorView | null>(null);
  const [editorMountGen, setEditorMountGen] = useState(0);
  const { theme: appTheme } = useTheme();
  /** `inlineCommentsExtension` returns one Extension; callers may pass an array — always normalize before spread. */
  const extraExtensionsList = useMemo((): Extension[] => {
    if (extraExtensions == null) return [];
    return Array.isArray(extraExtensions) ? extraExtensions : [extraExtensions];
  }, [extraExtensions]);

  const cmExtensions = useMemo(
    () => [
      ...cmExtensionsForPath(filePath || "", isMobile, codeWrap, appTheme),
      ...(codeWrap ? [EditorView.lineWrapping] : []),
      ...extraExtensionsList,
    ],
    [filePath, isMobile, codeWrap, appTheme, extraExtensionsList]
  );

  useEffect(() => {
    if (scrollToLine == null || fileLoading) return;
    const view = editorViewRef.current;
    if (!view) return;
    const doc = view.state.doc;
    const n = Math.min(Math.max(1, scrollToLine), doc.lines);
    const line = doc.line(n);
    view.dispatch({
      selection: EditorSelection.cursor(line.from),
      scrollIntoView: true,
    });
    onScrolledToLine?.();
  }, [scrollToLine, fileLoading, filePath, value, onScrolledToLine, editorMountGen]);

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
        key={`${filePath}-${appTheme}-${codeWrap ? "wrap" : "nowrap"}`}
        theme="none"
        extensions={cmExtensions}
        editable={false}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, highlightActiveLineGutter: true }}
        onCreateEditor={(view) => {
          editorViewRef.current = view;
          setEditorMountGen((g) => g + 1);
        }}
        onStatistics={(stats) => {
          if (!enableLineHistory) return;
          const line = stats.line.number;
          if (line !== selectedLine) onLineActivate(line);
        }}
        className="h-full min-h-[18rem] md:min-h-0"
      />
    </div>
  );
}
