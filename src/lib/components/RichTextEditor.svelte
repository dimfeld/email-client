<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { Markdown } from '@tiptap/markdown';
  import Image from '@tiptap/extension-image';
  import TextAlign from '@tiptap/extension-text-align';
  let {
    html,
    onchange,
    disabled = false,
  }: {
    html: string;
    disabled?: boolean;
    onchange: (html: string, text: string) => void;
  } = $props();
  let element: HTMLDivElement;
  let editor = $state.raw<Editor>();
  let markdownOpen = $state(false);
  let markdown = $state('');
  let linkOpen = $state(false);
  let link = $state('');
  let version = $state(0);
  onMount(() => {
    editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ link: { openOnClick: false } }),
        Markdown,
        Image.configure({ allowBase64: true }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
      ],
      content: html,
      editorProps: {
        attributes: { 'aria-label': 'Message body', role: 'textbox', 'aria-multiline': 'true' },
      },
      onUpdate: ({ editor }) => onchange(editor.getHTML(), editor.getText()),
      onTransaction: () => {
        version++;
      },
    });
    return () => editor?.destroy();
  });
  $effect(() => {
    editor?.setEditable(!disabled, false);
  });
  function active(mark: string) {
    version;
    return editor?.isActive(mark) ?? false;
  }
  async function insertImages(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    for (const file of input.files ?? []) {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      editor?.chain().focus().setImage({ src, alt: file.name }).run();
    }
    input.value = '';
  }
</script>

<div class="rich-editor">
  <div class="toolbar" role="toolbar" aria-label="Text formatting">
    <button
      type="button"
      title="Bold"
      aria-pressed={active('bold')}
      onclick={() => editor?.chain().focus().toggleBold().run()}><strong>B</strong></button
    >
    <button
      type="button"
      title="Italic"
      aria-pressed={active('italic')}
      onclick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></button
    >
    <button
      type="button"
      title="Underline"
      aria-pressed={active('underline')}
      onclick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button
    >
    <select
      aria-label="Paragraph style"
      onchange={(event) =>
        event.currentTarget.value === 'p'
          ? editor?.chain().focus().setParagraph().run()
          : editor
              ?.chain()
              .focus()
              .toggleHeading({ level: Number(event.currentTarget.value) as 1 | 2 | 3 })
              .run()}
      ><option value="p">Paragraph</option><option value="1">Heading 1</option><option value="2"
        >Heading 2</option
      ><option value="3">Heading 3</option></select
    >
    <button
      type="button"
      title="Bullet list"
      aria-pressed={active('bulletList')}
      onclick={() => editor?.chain().focus().toggleBulletList().run()}>• List</button
    >
    <button
      type="button"
      title="Numbered list"
      aria-pressed={active('orderedList')}
      onclick={() => editor?.chain().focus().toggleOrderedList().run()}>1. List</button
    >
    <button
      type="button"
      title="Quote"
      aria-pressed={active('blockquote')}
      onclick={() => editor?.chain().focus().toggleBlockquote().run()}>Quote</button
    >
    <button
      type="button"
      title="Code"
      aria-pressed={active('codeBlock')}
      onclick={() => editor?.chain().focus().toggleCodeBlock().run()}>Code</button
    >
    <button
      type="button"
      title="Insert link"
      onclick={() => {
        link = editor?.getAttributes('link').href ?? '';
        linkOpen = !linkOpen;
      }}>Link</button
    >
    <select
      aria-label="Text alignment"
      onchange={(event) => editor?.chain().focus().setTextAlign(event.currentTarget.value).run()}
      ><option value="left">Left</option><option value="center">Center</option><option value="right"
        >Right</option
      ></select
    >
    <label class="image-button"
      >Image<input type="file" accept="image/*" multiple onchange={insertImages} /></label
    >
    <button type="button" title="Undo edit" onclick={() => editor?.chain().focus().undo().run()}
      >↶</button
    ><button type="button" title="Redo edit" onclick={() => editor?.chain().focus().redo().run()}
      >↷</button
    >
    <button type="button" onclick={() => (markdownOpen = !markdownOpen)}>Insert Markdown</button>
  </div>
  {#if linkOpen}<div class="insert">
      <label
        >Link URL <input type="url" bind:value={link} placeholder="https://example.com" /></label
      ><button
        type="button"
        onclick={() => {
          if (/^(https?:|mailto:)/i.test(link))
            editor?.chain().focus().extendMarkRange('link').setLink({ href: link }).run();
          else if (!link) editor?.chain().focus().unsetLink().run();
          linkOpen = false;
        }}>Apply link</button
      >
    </div>{/if}
  {#if markdownOpen}<div class="insert">
      <label for="markdown-input">Markdown</label><textarea
        id="markdown-input"
        bind:value={markdown}
        rows="5"
        placeholder="## Heading"></textarea><button
        type="button"
        onclick={() => {
          editor?.chain().focus().insertContent(markdown, { contentType: 'markdown' }).run();
          markdown = '';
          markdownOpen = false;
        }}>Insert as rich text</button
      >
    </div>{/if}
  <div class="editor-content" bind:this={element}></div>
  <p class="hint">
    Markdown shortcuts: type ## then Space for a heading, or - then Space for a list.
  </p>
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px;
    border-bottom: 1px solid var(--color-border-strong);
  }
  button,
  select,
  .image-button {
    background: var(--color-surface-raised);
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    padding: 5px 7px;
    font: inherit;
    font-size: 0.72rem;
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    color: var(--color-accent-text);
    border-color: var(--color-accent-text);
  }
  .image-button input {
    display: none;
  }
  .editor-content {
    padding: 14px;
    background: var(--color-paper);
    color: var(--color-paper-text);
    min-height: 180px;
  }
  .editor-content :global(.tiptap) {
    outline: none;
    min-height: 150px;
    overflow-wrap: anywhere;
  }
  .editor-content :global(p) {
    margin: 0.5em 0;
  }
  .editor-content :global(img) {
    max-width: 100%;
    height: auto;
  }
  .editor-content :global(blockquote) {
    border-left: 3px solid var(--color-paper-border);
    padding-left: 12px;
    margin-inline: 0;
    color: var(--color-paper-muted);
  }
  .editor-content :global(pre) {
    white-space: pre-wrap;
    background: var(--color-paper-code);
    padding: 10px;
  }
  .editor-content :global(a) {
    color: var(--color-paper-link);
  }
  .hint {
    margin: 0;
    padding: 8px 12px;
    font-size: 0.68rem;
    color: var(--color-text-muted);
  }
  .insert {
    padding: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 0.8rem;
  }
  .insert textarea {
    width: 100%;
    font: inherit;
    background: var(--color-surface-sunken);
    color: var(--color-text);
    border: 1px solid var(--color-border-hover);
    padding: 8px;
  }
  .insert input {
    font: inherit;
    background: var(--color-surface-sunken);
    color: var(--color-text);
    border: 1px solid var(--color-border-hover);
    padding: 5px;
  }
</style>
