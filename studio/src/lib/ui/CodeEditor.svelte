<script lang="ts">
  import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { javascript } from "@codemirror/lang-javascript";
  import { HighlightStyle, bracketMatching, syntaxHighlighting } from "@codemirror/language";
  import { EditorState } from "@codemirror/state";
  import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
  import { tags } from "@lezer/highlight";
  import { onMount } from "svelte";
  import { CALL_SPECS as CALLS } from "../scripting/api";

  let { value = $bindable(""), onrun }: { value: string; onrun?: () => void } = $props();
  let host: HTMLDivElement;
  let view: EditorView | null = null;

  const EXTRA = [
    ["uart.passthrough", "({ txd, rxd, baud }) → handle"],
    ["uart.send", "(handle, text)"],
    ["uart.expect", "(handle, /regex/, timeoutMs) → { match, groups, before }"],
    ["uart.read", "(handle) → buffered text"],
    ["uart.close", "(handle)"],
    ["gpio.drive", "(value) → handle"],
    ["gpio.release", "(handle)"],
    ["term.send", "(text) raw to the JTAGulator"],
    ["term.expect", "(/regex/, timeoutMs)"],
    ["target.get", "() → known pins, findings"],
    ["sleep", "(ms)"],
    ["log", "(...values)"],
    ["hex", "(value, digits)"],
    ["bytes", "([..] | string) → Uint8Array"],
  ];

  function complete(ctx: CompletionContext) {
    const w = ctx.matchBefore(/[\w.]+/);
    if (!w || (w.from === w.to && !ctx.explicit)) return null;
    return {
      from: w.from,
      options: [
        ...Object.entries(CALLS).map(([k, v]) => ({ label: k, type: "function", detail: v.example ? `(${v.example})` : "()", info: v.doc })),
        ...EXTRA.map(([k, d]) => ({ label: k, type: "function", detail: d })),
      ],
    };
  }

  const style = HighlightStyle.define([
    { tag: tags.keyword, color: "var(--sig-tms)" },
    { tag: [tags.string, tags.special(tags.string)], color: "var(--sig-tdo)" },
    { tag: tags.number, color: "var(--sig-tck)" },
    { tag: tags.comment, color: "var(--text-faint)", fontStyle: "italic" },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--sig-tdi)" },
    { tag: tags.propertyName, color: "var(--sig-swdio)" },
    { tag: tags.regexp, color: "var(--sig-trst)" },
    { tag: [tags.bool, tags.null], color: "var(--sig-rtck)" },
  ]);

  const theme = EditorView.theme({
    "&": { height: "100%", background: "var(--bg)", color: "var(--text)", fontSize: "13px" },
    ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--accent)" },
    ".cm-gutters": { background: "var(--bg)", color: "var(--text-faint)", border: "none" },
    ".cm-activeLine": { background: "color-mix(in srgb, var(--overlay) 60%, transparent)" },
    ".cm-activeLineGutter": { background: "transparent", color: "var(--text-muted)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { background: "var(--accent-soft) !important" },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    ".cm-tooltip": { background: "var(--overlay)", border: "1px solid var(--border-strong)", color: "var(--text)" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "var(--accent-soft)", color: "var(--text)" },
    "&.cm-focused": { outline: "none" },
  });

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          javascript(),
          syntaxHighlighting(style),
          autocompletion({ override: [complete] }),
          keymap.of([
            { key: "Mod-Enter", run: () => (onrun?.(), true) },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) value = u.state.doc.toString();
          }),
        ],
      }),
    });
    return () => view?.destroy();
  });

  // External changes (switching scripts) replace the document.
  $effect(() => {
    const v = value;
    if (view && v !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    }
  });
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    height: 100%;
    overflow: hidden;
  }
  .editor :global(.cm-editor) {
    height: 100%;
  }
  .editor :global(.cm-scroller) {
    overflow: auto;
  }
</style>
