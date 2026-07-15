import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Elegant markdown renderer for assistant replies.
 *
 * Chat replies used to render as a plain <pre> — no headings, no lists, no
 * emphasis. This turns the same text into editorial typography: Newsreader
 * serif display headings, mono small-caps "markings" for h4/h5/h6, hairline
 * rules and refined lists. All visual styling lives in the `.chat-md` block in
 * app/x402-design.css so the two chat surfaces (live + shared) stay identical.
 *
 * No rehype-raw: raw HTML in the model output is intentionally NOT rendered.
 */

// Give fenced code blocks a data-lang marking (rendered as a tiny caption in CSS).
const components: Components = {
  code(props) {
    const { className, children, ...rest } = props
    const match = /language-(\w+)/.exec(className || '')
    const lang = match?.[1]
    return (
      <code className={className} data-lang={lang} {...rest}>
        {children}
      </code>
    )
  },
}

export default function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="chat-md">
      {/* singleTilde off: chat replies are full of "~$2" approximations, and
          GFM's single-tilde strikethrough turns "~$0.00 … ~$2" into struck
          text mid-sentence. Real strikethrough still works with ~~double~~. */}
      <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
