import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'

/** Extract plain text from arbitrary React children (for the copy button). */
function toText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(toText).join('')
  if (typeof node === 'object' && 'props' in (node as any)) {
    return toText((node as any).props?.children)
  }
  return ''
}

function CodeBlock({ children, language }: { children: ReactNode; language?: string }) {
  const [copied, setCopied] = useState(false)
  const code = toText(children).replace(/\n$/, '')

  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="group relative my-4 overflow-hidden rounded-xl border border-gray-200 bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-gray-400">
          {language || 'code'}
        </span>
        <button
          onClick={copy}
          aria-label={copied ? 'Code copied' : 'Copy code to clipboard'}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-gray-400 transition hover:bg-gray-800 hover:text-gray-100"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5">
        <code className="font-mono text-[12.5px] leading-relaxed text-gray-100">{code}</code>
      </pre>
    </div>
  )
}

export default function Markdown({ content }: { content: string }) {
  return (
    <div className="text-[14px] leading-[1.7] text-gray-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-6 border-b border-gray-100 pb-2 text-xl font-bold text-gray-900 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2.5 mt-6 text-[17px] font-bold text-gray-900 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-5 text-[15px] font-semibold text-gray-900 first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1.5 mt-4 text-[14px] font-semibold text-gray-800 first:mt-0">{children}</h4>
          ),
          p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-3 space-y-1.5 pl-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5">{children}</ol>,
          li: ({ children }) => (
            <li className="relative pl-4 marker:text-gray-400 [ol>&]:pl-0 before:absolute before:left-0 before:top-[0.62em] before:h-1 before:w-1 before:rounded-full before:bg-indigo-400 before:content-[''] [ol>&]:before:hidden">
              {children}
            </li>
          ),
          strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
          em: ({ children }) => <em className="italic text-gray-600">{children}</em>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:decoration-indigo-500"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 rounded-r-lg border-l-[3px] border-indigo-300 bg-indigo-50/50 py-2 pl-4 pr-3 text-gray-600">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-6 border-gray-100" />,
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-gray-200 px-3.5 py-2.5 text-left font-semibold text-gray-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-gray-100 px-3.5 py-2.5 align-top text-gray-600">{children}</td>
          ),
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '')
            const isInline = !className && !toText(children).includes('\n')

            if (isInline) {
              return (
                <code
                  className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[12.5px] text-indigo-700"
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return <CodeBlock language={match?.[1]}>{children}</CodeBlock>
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
