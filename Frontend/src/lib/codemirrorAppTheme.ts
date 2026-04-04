import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";

/** Matches app `ThemeContext` — keep literal to avoid import cycles. */
export type CmColorMode = "light" | "dark";

export function cmLanguageForPath(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".py")) return python();
  if (lower.endsWith(".tsx") || lower.endsWith(".ts"))
    return javascript({ typescript: true, jsx: true });
  if (lower.endsWith(".jsx") || lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
    return javascript({ jsx: true });
  return javascript({ jsx: false });
}

const DARK = {
  bg: "#0e0e12",
  gutterBg: "#0e0e12",
  gutterFg: "#9ca3af",
  fg: "#e8e9ef",
  cursor: "#c9a84c",
  selection: "rgba(201, 168, 76, 0.22)",
  activeLine: "rgba(201, 168, 76, 0.1)",
};

const LIGHT = {
  bg: "#f0f0f3",
  gutterBg: "#ebebef",
  gutterFg: "#6b6b75",
  fg: "#1a1a1e",
  cursor: "#9a7b2e",
  selection: "rgba(154, 123, 46, 0.2)",
  activeLine: "rgba(154, 123, 46, 0.12)",
};

/** Brighter, higher-contrast syntax for dark UI (fixes murky reds on black). */
const darkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c4a5f5" },
  { tag: tags.controlKeyword, color: "#c4a5f5" },
  { tag: tags.definitionKeyword, color: "#c4a5f5" },
  { tag: tags.moduleKeyword, color: "#7dd3fc" },
  { tag: tags.operatorKeyword, color: "#7dd3fc" },
  { tag: tags.operator, color: "#7dd3fc" },
  { tag: tags.punctuation, color: "#a8b0c4" },
  { tag: tags.brace, color: "#a8b0c4" },
  { tag: tags.paren, color: "#a8b0c4" },
  { tag: tags.squareBracket, color: "#a8b0c4" },
  { tag: tags.separator, color: "#a8b0c4" },
  { tag: tags.compareOperator, color: "#7dd3fc" },
  { tag: tags.arithmeticOperator, color: "#7dd3fc" },
  { tag: tags.name, color: "#f0abfc" },
  { tag: tags.variableName, color: "#e8e9ef" },
  { tag: tags.definition(tags.variableName), color: "#93c5fd" },
  { tag: tags.function(tags.variableName), color: "#93c5fd" },
  { tag: tags.propertyName, color: "#93c5fd" },
  { tag: tags.definition(tags.propertyName), color: "#a5b4fc" },
  { tag: tags.attributeName, color: "#fcd34d" },
  { tag: tags.attributeValue, color: "#86efac" },
  { tag: tags.string, color: "#86efac" },
  { tag: tags.special(tags.string), color: "#6ee7b7" },
  { tag: tags.regexp, color: "#6ee7b7" },
  { tag: tags.escape, color: "#fde047" },
  { tag: tags.number, color: "#fdba74" },
  { tag: tags.bool, color: "#fdba74" },
  { tag: tags.null, color: "#fdba74" },
  { tag: tags.atom, color: "#fdba74" },
  { tag: tags.literal, color: "#fdba74" },
  { tag: tags.unit, color: "#fdba74" },
  { tag: tags.typeName, color: "#fcd34d" },
  { tag: tags.className, color: "#fcd34d" },
  { tag: tags.namespace, color: "#7dd3fc" },
  { tag: tags.comment, color: "#8b92a8", fontStyle: "italic" },
  { tag: tags.lineComment, color: "#8b92a8", fontStyle: "italic" },
  { tag: tags.blockComment, color: "#8b92a8", fontStyle: "italic" },
  { tag: tags.docComment, color: "#8b92a8", fontStyle: "italic" },
  { tag: tags.meta, color: "#94a3b8" },
  { tag: tags.annotation, color: "#c4b5fd" },
  { tag: tags.self, color: "#f9a8d4" },
  { tag: tags.invalid, color: "#f87171" },
]);

const lightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#6d28d9" },
  { tag: tags.controlKeyword, color: "#6d28d9" },
  { tag: tags.definitionKeyword, color: "#6d28d9" },
  { tag: tags.moduleKeyword, color: "#0369a1" },
  { tag: tags.operatorKeyword, color: "#0369a1" },
  { tag: tags.operator, color: "#0369a1" },
  { tag: tags.punctuation, color: "#475569" },
  { tag: tags.brace, color: "#475569" },
  { tag: tags.paren, color: "#475569" },
  { tag: tags.squareBracket, color: "#475569" },
  { tag: tags.separator, color: "#475569" },
  { tag: tags.compareOperator, color: "#0369a1" },
  { tag: tags.arithmeticOperator, color: "#0369a1" },
  { tag: tags.name, color: "#a21caf" },
  { tag: tags.variableName, color: "#1e293b" },
  { tag: tags.definition(tags.variableName), color: "#1d4ed8" },
  { tag: tags.function(tags.variableName), color: "#1d4ed8" },
  { tag: tags.propertyName, color: "#1d4ed8" },
  { tag: tags.definition(tags.propertyName), color: "#4338ca" },
  { tag: tags.attributeName, color: "#b45309" },
  { tag: tags.attributeValue, color: "#047857" },
  { tag: tags.string, color: "#047857" },
  { tag: tags.special(tags.string), color: "#0f766e" },
  { tag: tags.regexp, color: "#0f766e" },
  { tag: tags.escape, color: "#a16207" },
  { tag: tags.number, color: "#c2410c" },
  { tag: tags.bool, color: "#c2410c" },
  { tag: tags.null, color: "#c2410c" },
  { tag: tags.atom, color: "#c2410c" },
  { tag: tags.literal, color: "#c2410c" },
  { tag: tags.unit, color: "#c2410c" },
  { tag: tags.typeName, color: "#b45309" },
  { tag: tags.className, color: "#b45309" },
  { tag: tags.namespace, color: "#0369a1" },
  { tag: tags.comment, color: "#64748b", fontStyle: "italic" },
  { tag: tags.lineComment, color: "#64748b", fontStyle: "italic" },
  { tag: tags.blockComment, color: "#64748b", fontStyle: "italic" },
  { tag: tags.docComment, color: "#64748b", fontStyle: "italic" },
  { tag: tags.meta, color: "#64748b" },
  { tag: tags.annotation, color: "#7c3aed" },
  { tag: tags.self, color: "#be185d" },
  { tag: tags.invalid, color: "#dc2626" },
]);

export function gitloreSyntaxHighlighting(mode: CmColorMode): Extension {
  return syntaxHighlighting(mode === "light" ? lightHighlight : darkHighlight, { fallback: true });
}

/** Editor chrome (background, gutters, selection) for light or dark app theme. */
export function buildCmTheme(mobile: boolean, lineWrap: boolean, mode: CmColorMode) {
  const fontSize = mobile ? "12px" : "13px";
  /** Match `EditorView.lineWrapping` on all viewports when the user enables soft wrap. */
  const wrap = lineWrap;
  const c = mode === "light" ? LIGHT : DARK;

  return EditorView.theme({
    "&": {
      backgroundColor: c.bg,
      color: c.fg,
      fontSize,
    },
    ".cm-content": { fontFamily: '"JetBrains Mono", monospace', padding: mobile ? "6px 0" : "8px 0" },
    ".cm-scroller": { overflowX: wrap ? "hidden" : "auto" },
    ".cm-gutters": {
      backgroundColor: c.gutterBg,
      color: c.gutterFg,
      border: "none",
      minWidth: mobile ? "32px" : "40px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: mobile ? "0 6px 0 2px" : "0 8px 0 4px",
      minWidth: mobile ? "24px" : "32px",
      cursor: "pointer",
    },
    ".cm-activeLine": { backgroundColor: c.activeLine },
    ".cm-activeLineGutter": { backgroundColor: c.activeLine },
    "&.cm-focused .cm-cursor": { borderLeftColor: c.cursor },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: c.selection },
    ".cm-line": {
      padding: mobile ? "0 6px" : "0 8px",
      whiteSpace: wrap ? "pre-wrap" : "pre",
      overflowWrap: wrap ? "anywhere" : "normal",
    },
  });
}

/** All CodeMirror extensions for the live repo editor (language + theme + highlighting). */
export function cmExtensionsForPath(
  filePath: string,
  mobile: boolean,
  lineWrap: boolean,
  mode: CmColorMode
): Extension[] {
  return [
    cmLanguageForPath(filePath || ""),
    buildCmTheme(mobile, lineWrap, mode),
    gitloreSyntaxHighlighting(mode),
  ];
}

export { EditorView };
