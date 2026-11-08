import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeBlock from '../CodeBlock.jsx'
import styles from './TheoryBlock.module.css'

// Блок кода в Markdown приходит как <pre><code class="language-sql">…</code></pre>.
// Перехватываем <pre> и рендерим свой CodeBlock с кнопкой копирования.
function Pre({ node }) {
  const codeEl = node?.children?.[0]
  const className = codeEl?.properties?.className?.[0] ?? ''
  const language = className.replace('language-', '')
  const code = (codeEl?.children ?? [])
    .map((child) => child.value ?? '')
    .join('')
    .replace(/\n$/, '')

  return <CodeBlock code={code} language={language} />
}

function ExternalLink({ href, children }) {
  const isExternal = /^https?:\/\//.test(href ?? '')
  return (
    <a href={href} {...(isExternal && { target: '_blank', rel: 'noreferrer' })}>
      {children}
    </a>
  )
}

const components = { pre: Pre, a: ExternalLink }

export default function TheoryBlock({ markdown }) {
  if (!markdown.trim()) {
    return <p className={styles.empty}>Теория ещё не написана.</p>
  }

  return (
    <div className={styles.prose}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </Markdown>
    </div>
  )
}
