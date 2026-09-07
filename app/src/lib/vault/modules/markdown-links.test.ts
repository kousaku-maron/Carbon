import { describe, expect, it } from "vitest";
import { collectMarkdownLinks, rewriteMarkdownLinks } from "./markdown-links";

const vault = "/vault";
const rewrite = (body: string, source = "/vault/a.md", from = "/vault/notes", to = "/vault/archive/notes") =>
  rewriteMarkdownLinks(body, source, vault, from, to);

describe("Markdown link relocation", () => {
  it("changes only destinations, preserving labels, titles, CRLF and surrounding formatting", () => {
    const body = '# A\r\n\r\n- **[custom label](notes/b.md#heading "title")**\r\n';
    expect(rewrite(body)).toBe('# A\r\n\r\n- **[custom label](./archive/notes/b.md#heading "title")**\r\n');
  });
  it("rebases outgoing images and links while leaving co-moved links byte-for-byte intact", () => {
    expect(rewrite('[B](b.md) ![image](../.carbon/image.png) [A](../a.md)', '/vault/notes/a.md'))
      .toBe('[B](b.md) ![image](../../.carbon/image.png) [A](../../a.md)');
  });
  it("handles definitions, escaped parentheses, angle destinations and URI encoding", () => {
    const body = '[x][ref]\n\n[ref]: <notes/a b.md> "T"\n\n[x](notes/a\\(b\\).md) [y](notes/a%20b.md)';
    expect(rewrite(body)).toBe('[x][ref]\n\n[ref]: <./archive/notes/a%20b.md> "T"\n\n[x](./archive/notes/a%28b%29.md) [y](./archive/notes/a%20b.md)');
  });
  it("ignores inline code, fenced and indented code, comments, frontmatter and external URLs", () => {
    const body = '---\nkey: "[B](notes/b.md)"\n---\n\n`[B](notes/b.md)`\n\n```md\n[B](notes/b.md)\n```\n\n    [B](notes/b.md)\n\n<!-- [B](notes/b.md) -->\n\n[web](https://example.com/notes/b.md) [email](mailto:a@b.com) [anchor](#hi)';
    expect(collectMarkdownLinks(body, '/vault/a.md', vault)).toEqual([]);
    expect(rewrite(body)).toBe(body);
  });
  it("preserves root-relative links and queries/fragments", () => {
    expect(rewrite('[x](/notes/b.md?view=1#heading)')).toBe('[x](/archive/notes/b.md?view=1#heading)');
    expect(rewrite('[x](/a.md)', '/vault/notes/b.md')).toBe('[x](/a.md)');
  });
  it("does not confuse path prefixes or change unrelated links", () => {
    expect(rewrite('[x](notes-other/b.md) [y](a.md)')).toBe('[x](notes-other/b.md) [y](a.md)');
  });
  it("updates images when the asset itself moves", () => {
    expect(rewrite('![x](photo.png)', '/vault/a.md', '/vault/photo.png', '/vault/media/photo.png'))
      .toBe('![x](./media/photo.png)');
  });
  it("handles encoded hash characters as part of filenames", () => {
    expect(rewrite('[x](notes/a%23b.md#hello)')).toBe('[x](./archive/notes/a%23b.md#hello)');
  });
  it("handles nested link labels and nested parentheses", () => {
    expect(rewrite('[**x** ![y](notes/img.png)](notes/a(b).md)'))
      .toBe('[**x** ![y](./archive/notes/img.png)](./archive/notes/a%28b%29.md)');
  });
});
