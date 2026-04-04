import { RangeSetBuilder, StateField, type Text, type Extension } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { animate as animeAnimate } from "animejs";
import { CommentBadge, type CommentBadgeData } from "./CommentBadge";

function glowCmLine(line: number): void {
  const lines = document.querySelectorAll(".cm-content .cm-line");
  const el = lines[line - 1] as HTMLElement | undefined;
  if (!el) return;
  animeAnimate(el, {
    backgroundColor: [
      "transparent",
      "rgba(201,168,76,0.14)",
      "transparent",
    ],
    duration: 800,
    ease: "outQuart",
  });
}

class CommentWidget extends WidgetType {
  private root: Root | null = null;

  constructor(
    readonly comment: CommentBadgeData,
    readonly onCommentClick: (c: CommentBadgeData) => void
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "gitlore-inline-comment pl-8 pr-2 md:pl-10";
    wrap.style.maxWidth = "100%";
    this.root = createRoot(wrap);
    this.root.render(
      <CommentBadge
        comment={this.comment}
        onClick={(c) => {
          glowCmLine(c.line);
          this.onCommentClick(c);
        }}
      />
    );
    return wrap;
  }

  destroy(dom: HTMLElement): void {
    this.root?.unmount();
    this.root = null;
  }

  eq(other: CommentWidget): boolean {
    return (
      other instanceof CommentWidget && other.comment.id === this.comment.id
    );
  }

  ignoreEvent(): boolean {
    return false;
  }

  get estimatedHeight(): number {
    return 44;
  }
}

function buildDecorations(
  doc: Text,
  comments: CommentBadgeData[],
  onCommentClick: (c: CommentBadgeData) => void
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const c of comments) {
    if (c.line == null || c.line < 1) continue;
    if (c.line > doc.lines) continue;
    const line = doc.line(c.line);
    const deco = Decoration.widget({
      widget: new CommentWidget(c, onCommentClick),
      block: true,
      side: 1,
    });
    builder.add(line.to, line.to, deco);
  }
  return builder.finish();
}

/**
 * CodeMirror 6 extension: inject comment badges below given 1-based line numbers.
 * Block widgets must be provided via StateField — ViewPlugin decorations cannot be block-level.
 */
export function inlineCommentsExtension(
  comments: CommentBadgeData[],
  enabled: boolean,
  onCommentClick: (c: CommentBadgeData) => void
): Extension {
  if (!enabled || comments.length === 0) {
    return [];
  }

  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state.doc, comments, onCommentClick);
    },
    update(decorations, tr) {
      if (tr.docChanged) {
        return decorations.map(tr.changes);
      }
      return decorations;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
