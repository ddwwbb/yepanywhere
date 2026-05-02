import type { HTMLAttributes } from "react";

export type TrustedHtmlSource =
  | "server-rendered-markdown"
  | "server-rendered-syntax-highlight"
  | "server-rendered-diff"
  | "streaming-markdown-augment";

type TrustedHtmlProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "dangerouslySetInnerHTML"
> & {
  html: string;
  source: TrustedHtmlSource;
};

export function TrustedHtml({ html, source, ...props }: TrustedHtmlProps) {
  return (
    <div
      {...props}
      data-trusted-html-source={source}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: centralized trusted HTML boundary
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
