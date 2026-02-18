import { toString } from 'mdast-util-to-string';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

const markdownToHtmlProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify);

const markdownToTextParser = unified()
  .use(remarkParse)
  .use(remarkGfm);

export async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const file = await markdownToHtmlProcessor.process(markdown ?? '');
  return String(file);
}

export function markdownToExcerpt(markdown: string, maxLength = 160): string {
  const tree = markdownToTextParser.parse(markdown ?? '');
  const plain = toString(tree).replace(/\s+/g, ' ').trim();

  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength).trimEnd()}...`;
}
