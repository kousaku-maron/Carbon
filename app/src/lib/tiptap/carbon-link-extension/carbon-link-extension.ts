import Link from "@tiptap/extension-link";
import type { LinkOptions } from "@tiptap/extension-link";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import {
  buildSuggestionConfig,
  type CarbonLinkSuggestionConfig,
} from "./note-link-suggestion";

/** Default isInternal: treat scheme-less hrefs as internal (i.e. relative paths). */
export function isRelativePath(href: string): boolean {
  if (!href) return false;
  if (/^\w+:/.test(href)) return false;
  return true;
}

export interface CarbonLinkOptions extends LinkOptions {
  isInternal: (href: string) => boolean;
  onOpenInternal: ((href: string) => void) | null;
  onOpenExternal: ((href: string) => void) | null;
  /** When set, enables `[[` suggestion for internal note links. */
  suggestion: CarbonLinkSuggestionConfig | null;
}

/**
 * Link extension customised for Carbon.
 *
 * Links are rendered as `<span data-href>` instead of `<a>` to prevent
 * the SPA router from intercepting clicks.
 *
 * When `openOnClick` is true:
 *   - Internal links navigate within the app via `onOpenInternal`
 *   - External links open in the default browser via `onOpenExternal`
 * When `openOnClick` is false:
 *   - No links are opened on click
 */
export const CarbonLink = Link.extend<CarbonLinkOptions>({
  addOptions() {
    const opts: CarbonLinkOptions = {
      ...this.parent!(),
      isInternal: isRelativePath,
      onOpenInternal: null,
      onOpenExternal: null,
      suggestion: null,
    };

    return opts;
  },

  // Render as <span> instead of <a> to prevent the SPA router from intercepting clicks.
  renderHTML({ HTMLAttributes }) {
    const href: string = HTMLAttributes.href ?? "";
    const internal = this.options.isInternal?.(href) ?? false;

    return [
      "span",
      {
        ...HTMLAttributes,
        "data-href": href,
        href: undefined,
        class: internal ? "carbon-link carbon-link--internal" : "carbon-link",
      },
      0,
    ];
  },

  addProseMirrorPlugins() {
    // Drop the parent's click handler (<a>-based) and use our own for <span data-href>.
    const plugins = this.parent!().filter(
      (p) => (p as unknown as { key: string }).key !== "handleClickLink$",
    );

    plugins.push(
      new Plugin({
        key: new PluginKey("carbonClickLink"),
        props: {
          handleClick: (view, _pos, event) => {
            if (event.button !== 0) return false;

            const openOnClick =
              this.options.openOnClick === "whenNotEditable"
                ? true
                : this.options.openOnClick;
            if (!openOnClick) return false;

            // Find the link element from the click target.
            const target = event.target as HTMLElement | null;
            if (!target) return false;
            const root = view.dom;
            const link = target.closest<HTMLElement>("[data-href]");
            if (!link || !root.contains(link)) return false;

            const href = link.getAttribute("data-href");
            if (!href) return false;

            const { isInternal, onOpenInternal, onOpenExternal } = this.options;

            // Internal link → app navigation
            if (isInternal?.(href)) {
              onOpenInternal?.(href);
              return true;
            }

            // External link → open in default browser
            onOpenExternal?.(href);
            return true;
          },
        },
      }),
    );

    // [[ suggestion plugin for internal note links.
    if (this.options.suggestion) {
      plugins.push(
        Suggestion({
          editor: this.editor,
          ...buildSuggestionConfig(this.options.suggestion),
        }),
      );
    }

    return plugins;
  },
});
