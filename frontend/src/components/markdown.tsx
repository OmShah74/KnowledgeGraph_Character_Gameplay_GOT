"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Convert [[slug|Label]] wiki links into markdown links handled by the wiki page. */
export function wikiToMarkdown(md: string, scope: string): string {
  return md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, slug: string, label?: string) => {
    const text = (label || slug).replace(/[[\]]/g, "");
    return `[${text}](/wiki?slug=${encodeURIComponent(slug)}&scope=${encodeURIComponent(scope)})`;
  });
}

export function Markdown({ content, scope = "canon", className }: { content: string; scope?: string; className?: string }) {
  return (
    <div className={cn("prose-got text-sm", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href && href.startsWith("/") ? <Link href={href}>{children}</Link> : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
        }}
      >
        {wikiToMarkdown(content || "", scope)}
      </ReactMarkdown>
    </div>
  );
}
