import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";

export function cmLanguageForPath(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".py")) return python();
  if (lower.endsWith(".tsx") || lower.endsWith(".ts"))
    return javascript({ typescript: true, jsx: true });
  if (lower.endsWith(".jsx") || lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
    return javascript({ jsx: true });
  return javascript({ jsx: false });
}

/** `mobileSoftWrap` applies only when `mobile`; desktop always uses no-wrap + horizontal scroll. */
export function buildCmTheme(mobile: boolean, mobileSoftWrap: boolean) {
  const fontSize = mobile ? "12px" : "13px";
  const wrap = mobile && mobileSoftWrap;
  return EditorView.theme({
    "&": { backgroundColor: "#0A0A0D", color: "#EDEDEF", fontSize },
    ".cm-content": { fontFamily: '"JetBrains Mono", monospace', padding: mobile ? "6px 0" : "8px 0" },
    ".cm-scroller": { overflowX: wrap ? "hidden" : "auto" },
    ".cm-gutters": { backgroundColor: "#0A0A0D", color: "#7C7C86", border: "none", minWidth: mobile ? "32px" : "40px" },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: mobile ? "0 6px 0 2px" : "0 8px 0 4px",
      minWidth: mobile ? "24px" : "32px",
      cursor: "pointer",
    },
    ".cm-activeLine": { backgroundColor: "rgba(201, 168, 76, 0.08)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(201, 168, 76, 0.08)" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#C9A84C" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgba(201, 168, 76, 0.2)" },
    ".cm-line": {
      padding: mobile ? "0 6px" : "0 8px",
      whiteSpace: wrap ? "pre-wrap" : "pre",
      overflowWrap: wrap ? "anywhere" : "normal",
    },
  });
}

export { EditorView };
