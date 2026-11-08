import { Link } from 'react-router'

export default function NotFound() {
  return (
    <>
      <h1>404</h1>
      <p>Такой страницы нет.</p>
      <Link to="/">← На главную</Link>
    </>
  )
}
