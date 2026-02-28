interface CodeBlockProps {
  code: string;
}

export function CodeBlock(props: CodeBlockProps) {
  return (
    <pre class="code-block">
      <code>{props.code}</code>
    </pre>
  );
}
