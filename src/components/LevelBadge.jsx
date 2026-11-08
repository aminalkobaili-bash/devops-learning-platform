import { LEVEL_LABELS } from '../content/content.js'
import styles from './LevelBadge.module.css'

export default function LevelBadge({ level }) {
  return <span className={`${styles.badge} ${styles[level]}`}>{LEVEL_LABELS[level] ?? level}</span>
}
