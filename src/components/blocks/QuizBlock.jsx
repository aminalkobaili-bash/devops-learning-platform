import { useEffect, useState } from 'react'
import useLocalStorage from '../../hooks/useLocalStorage.js'
import styles from './QuizBlock.module.css'

function Question({ q, index, picked, onPick }) {
  const answered = picked !== undefined

  function optionClass(i) {
    if (!answered) return styles.option
    if (i === q.correctIndex) return `${styles.option} ${styles.correct}`
    if (i === picked) return `${styles.option} ${styles.wrong}`
    return `${styles.option} ${styles.dim}`
  }

  return (
    <fieldset className={styles.question}>
      <legend className={styles.legend}>
        <span className={styles.num}>{index + 1}.</span> {q.question}
      </legend>

      <div className={styles.options}>
        {q.options.map((option, i) => (
          <button
            key={i}
            type="button"
            className={optionClass(i)}
            disabled={answered}
            onClick={() => onPick(i)}
          >
            {option}
          </button>
        ))}
      </div>

      {answered && (
        <p className={picked === q.correctIndex ? styles.okText : styles.errText}>
          {picked === q.correctIndex ? '✓ Верно. ' : '✗ Неверно. '}
          {q.explanation}
        </p>
      )}
    </fieldset>
  )
}

export default function QuizBlock({ questions, storageKey }) {
  // answers: { [questionId]: индекс выбранного варианта }
  const [answers, setAnswers] = useState({})
  const [best, setBest] = useLocalStorage(storageKey, null)

  const answeredCount = Object.keys(answers).length
  const finished = questions.length > 0 && answeredCount === questions.length
  const score = questions.filter((q) => answers[q.id] === q.correctIndex).length

  // Квиз завершён — сохраняем лучший результат
  useEffect(() => {
    if (finished) setBest((prev) => Math.max(prev ?? 0, score))
  }, [finished, score, setBest])

  // ранний return — только после всех хуков (правило хуков)
  if (questions.length === 0) {
    return <p className={styles.empty}>Вопросов пока нет.</p>
  }

  function pick(questionId, optionIndex) {
    // функциональное обновление: каждый клик видит актуальный state, а не значение из замыкания
    setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }))
  }

  return (
    <>
      <p className={styles.status}>
        {finished ? `Результат: ${score} из ${questions.length}` : `Отвечено ${answeredCount} из ${questions.length}`}
        {best !== null && ` · лучший: ${best} из ${questions.length}`}
      </p>

      <div className={styles.list}>
        {questions.map((q, i) => (
          <Question key={q.id} q={q} index={i} picked={answers[q.id]} onPick={(opt) => pick(q.id, opt)} />
        ))}
      </div>

      {finished && (
        <div className={styles.result}>
          <span>
            {score === questions.length ? 'Тема закрыта 🎉' : 'Перечитай теорию по ошибкам и попробуй снова.'}
          </span>
          <button type="button" className={styles.retry} onClick={() => setAnswers({})}>
            Пройти заново
          </button>
        </div>
      )}
    </>
  )
}
