import { useState } from 'react'
import CodeBlock from '../CodeBlock.jsx'
import useLocalStorage from '../../hooks/useLocalStorage.js'
import styles from './PracticeBlock.module.css'

function TaskCard({ task, index, solved, onToggleSolved }) {
  const [showHint, setShowHint] = useState(false)
  const [showSolution, setShowSolution] = useState(false)

  return (
    <article className={`${styles.card} ${solved ? styles.solved : ''}`}>
      <header className={styles.head}>
        <span className={styles.num}>{task.id ?? `#${index + 1}`}</span>
        <label className={styles.check}>
          <input type="checkbox" checked={solved} onChange={onToggleSolved} />
          решено
        </label>
      </header>

      <p className={styles.task}>{task.task}</p>

      <div className={styles.actions}>
        {task.hint && (
          <button type="button" className={styles.btnGhost} onClick={() => setShowHint((v) => !v)}>
            {showHint ? 'Скрыть подсказку' : 'Подсказка'}
          </button>
        )}
        <button
          type="button"
          className={styles.btn}
          aria-expanded={showSolution}
          onClick={() => setShowSolution((v) => !v)}
        >
          {showSolution ? 'Скрыть ответ' : 'Показать ответ'}
        </button>
      </div>

      {showHint && <p className={styles.hint}>💡 {task.hint}</p>}

      {showSolution && (
        <div className={styles.solution}>
          <CodeBlock code={task.solution} language={task.language} />
          {task.note && <p className={styles.note}>{task.note}</p>}
        </div>
      )}
    </article>
  )
}

export default function PracticeBlock({ tasks, storageKey }) {
  const [solvedIds, setSolvedIds] = useLocalStorage(storageKey, [])

  if (tasks.length === 0) {
    return <p className={styles.empty}>Задач пока нет.</p>
  }

  function toggle(id) {
    setSolvedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const solvedCount = tasks.filter((t) => solvedIds.includes(t.id)).length

  return (
    <>
      <p className={styles.progress}>
        Решено {solvedCount} из {tasks.length}
      </p>
      <div className={styles.list}>
        {tasks.map((task, i) => (
          <TaskCard
            key={task.id}
            task={task}
            index={i}
            solved={solvedIds.includes(task.id)}
            onToggleSolved={() => toggle(task.id)}
          />
        ))}
      </div>
    </>
  )
}
