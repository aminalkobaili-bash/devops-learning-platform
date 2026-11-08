import { Link } from 'react-router'
import projects from '../content/index.json'
import styles from './HomePage.module.css'

const sorted = [...projects].sort((a, b) => a.order - b.order)

function ProjectCard({ project }) {
  const body = (
    <>
      <div className={styles.cardHead}>
        <span className={styles.order}>{String(project.order).padStart(2, '0')}</span>
        {!project.ready && <span className={styles.badge}>скоро</span>}
      </div>
      <h2 className={styles.cardTitle}>{project.title}</h2>
      <p className={styles.cardText}>{project.description}</p>
      <ul className={styles.tags}>
        {project.tags.map((tag) => (
          <li key={tag}>{tag}</li>
        ))}
      </ul>
    </>
  )

  return project.ready ? (
    <Link to={`/p/${project.id}`} className={styles.card}>
      {body}
    </Link>
  ) : (
    <div className={`${styles.card} ${styles.disabled}`} aria-disabled="true">
      {body}
    </div>
  )
}

export default function HomePage() {
  const readyCount = sorted.filter((p) => p.ready).length

  return (
    <>
      <section className={styles.hero}>
        <h1>База знаний по проектам</h1>
        <p className={styles.lead}>
          Теория, практика со скрытыми решениями и квиз. Порядок — от простого к сложному.
        </p>
        <p className={styles.meta}>
          Готово {readyCount} из {sorted.length}
        </p>
      </section>

      <div className={styles.grid}>
        {sorted.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </>
  )
}
