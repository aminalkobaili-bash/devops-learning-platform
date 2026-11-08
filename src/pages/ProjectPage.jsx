import { Link, useParams } from 'react-router'
import { getProject } from '../content/content.js'
import LevelBadge from '../components/LevelBadge.jsx'
import NotFound from './NotFound.jsx'
import styles from './ProjectPage.module.css'

function ModuleRow({ projectId, module }) {
  const body = (
    <>
      <span className={styles.num}>{String(module.order).padStart(2, '0')}</span>
      <div className={styles.info}>
        <span className={styles.title}>{module.title}</span>
        <span className={styles.topics}>{module.topics.join(' · ')}</span>
      </div>
      <LevelBadge level={module.level} />
    </>
  )

  return module.ready ? (
    <Link to={`/p/${projectId}/${module.id}`} className={styles.row}>
      {body}
    </Link>
  ) : (
    <div className={`${styles.row} ${styles.disabled}`} aria-disabled="true">
      {body}
    </div>
  )
}

export default function ProjectPage() {
  const { projectId } = useParams()
  const project = getProject(projectId)

  if (!project) return <NotFound />

  return (
    <>
      <Link to="/" className={styles.back}>
        ← Все проекты
      </Link>

      <header className={styles.header}>
        <h1>{project.title}</h1>
        <p className={styles.lead}>{project.description}</p>
        <ul className={styles.stack}>
          {project.stack.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <a href={project.repo} target="_blank" rel="noreferrer">
          Репозиторий на GitHub ↗
        </a>
      </header>

      <h2 className={styles.sectionTitle}>Модули</h2>
      <div className={styles.list}>
        {project.modules.map((module) => (
          <ModuleRow key={module.id} projectId={project.id} module={module} />
        ))}
      </div>
    </>
  )
}
