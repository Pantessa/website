import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import TokenIcon from '@/components/TokenIcon'
import { tokenMark } from '@/lib/token-icons'

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

/** The cell's text, but only when the cell IS that text — a lone symbol,
 *  optionally bolded. Anything longer (a sentence, a link, a number with a
 *  unit) returns null and the cell renders untouched. */
function loneToken(children: ReactNode): string | null {
  const flat = Children.toArray(children).filter((c) => !(typeof c === 'string' && !c.trim()))
  if (flat.length !== 1) return null
  const only = flat[0]
  if (typeof only === 'string') return only.trim() || null
  if (isValidElement(only)) {
    const inner = (only.props as { children?: ReactNode }).children
    return typeof inner === 'string' ? inner.trim() || null : null
  }
  return null
}

/** Holdings tables lead with the ticker ("SYMBOL | TYPE | BALANCE | …"), so
 *  the mark belongs on the first cell of a row and only there — a later
 *  column that happens to read ON or F is a status, not ON Semiconductor. */
const isLeadCell = (props: Record<string, unknown>) => props['data-cell'] === 0

const components: Components = {
  // Give fenced code blocks a data-lang marking (rendered as a tiny caption in CSS).
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
  // Number the cells so `td` can tell the lead column from the rest.
  tr(props) {
    const { children, node, ...rest } = props
    void node
    let index = 0
    return (
      <tr {...rest}>
        {Children.map(children, (child) =>
          isValidElement(child)
            ? cloneElement(child as ReactElement<Record<string, unknown>>, { 'data-cell': index++ })
            : child,
        )}
      </tr>
    )
  },
  td(props) {
    const { children, node, ...rest } = props
    void node
    const lead = isLeadCell(rest as Record<string, unknown>) ? loneToken(children) : null
    // Ticker-shaped: upper-case, short, no spaces. "Tokenized Stock" isn't.
    const ticker = lead && /^[A-Z][A-Z0-9.]{0,5}$/.test(lead) ? lead : null
    if (!ticker) return <td {...rest}>{children}</td>
    const mark = tokenMark(ticker)
    return (
      <td {...rest}>
        <span className="chat-md__sym">
          {/* A ticker we have no art for still holds the column: the gap is
              reserved so USDG doesn't sit a mark's width left of AAPL. */}
          {mark ? <TokenIcon symbol={ticker} size={18} /> : <span className="chat-md__sym-gap" aria-hidden />}
          {children}
        </span>
      </td>
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
