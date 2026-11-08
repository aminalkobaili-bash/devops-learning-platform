import { Fragment } from 'react'
import { Link, useParams } from 'react-router'
import { getModule } from '../content/content.js'
import LevelBadge from '../components/LevelBadge.jsx'
import TheoryBlock from '../components/blocks/TheoryBlock.jsx'
import PracticeBlock from '../components/blocks/PracticeBlock.jsx'
import QuizBlock from '../components/blocks/QuizBlock.jsx'
import NotFound from './NotFound.jsx'
import styles from './ModulePage.module.css'

const SECTIONS = [
  { id: 'theory', title: 'Теория' },
  { id: 'practice', title: 'Практика' },
  { id: 'quiz', title: 'Квиз' },
]

function Section({ id, title, children }) {
  return (
    <section id={id} className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  )
}

function ModuleNav({ projectId, prev, next }) {
  return (
    <nav className={styles.pager}>
      {prev ? (
        <Link to={`/p/${projectId}/${prev.id}`}>← {prev.title}</Link>
      ) : (
        <span />
      )}
      {next && <Link to={`/p/${projectId}/${next.id}`}>{next.title} →</Link>}
    </nav>
  )
}

export default function ModulePage() {
  const { projectId, moduleId } = useParams()
  const result = getModule(projectId, moduleId)

  if (!result) return <NotFound />

  const { project, meta, data, theory, prev, next } = result

  return (
    <>
      <Link to={`/p/${project.id}`} className={styles.back}>
        ← {project.title}
      </Link>

      <header className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.num}>Модуль {String(meta.order).padStart(2, '0')}</span>
          <LevelBadge level={meta.level} />
        </div>
        <h1>{meta.title}</h1>
        {data && (
          <nav className={styles.toc}>
            {/* Кнопки, а не <a href="#id">: в HashRouter часть URL после # занята маршрутом */}
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' })}
              >
                {s.title}
              </button>
            ))}
          </nav>
        )}
      </header>

      {data ? (
        // key пересоздаёт блоки при переходе на другой модуль: сбрасываются
        // открытые ответы, а прогресс читается из своего ключа localStorage
        <Fragment key={`${project.id}/${meta.id}`}>
          <Section id="theory" title="Теория">
            <TheoryBlock markdown={theory} />
          </Section>
          <Section id="practice" title="Практика">
            <PracticeBlock tasks={data.practice} storageKey={`practice:${project.id}/${meta.id}`} />
          </Section>
          <Section id="quiz" title="Квиз">
            <QuizBlock questions={data.quiz} storageKey={`quiz:${project.id}/${meta.id}`} />
          </Section>
        </Fragment>
      ) : (
        <p className={styles.empty}>Модуль ещё не заполнен.</p>
      )}

      <ModuleNav projectId={project.id} prev={prev} next={next} />
    </>
  )
}
