import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import styles from './Layout.module.css'

export default function Layout() {
  const { pathname } = useLocation()

  // При переходе на другую страницу начинать сверху, а не с прокрутки прошлой
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.logo}>
          <span className={styles.prompt}>$</span> devops-learning
        </Link>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
