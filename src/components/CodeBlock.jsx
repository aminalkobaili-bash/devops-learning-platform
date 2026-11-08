import { useState } from 'react'
import styles from './CodeBlock.module.css'

export default function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Буфер обмена недоступен (например, не HTTPS) — просто ничего не делаем.
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <span className={styles.lang}>{language || 'code'}</span>
        <button type="button" className={styles.copy} onClick={handleCopy}>
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre className={styles.pre}>
        <code>{code}</code>
      </pre>
    </div>
  )
}
