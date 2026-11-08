import { Routes, Route } from 'react-router'
import Layout from './components/Layout.jsx'
import HomePage from './pages/HomePage.jsx'
import ProjectPage from './pages/ProjectPage.jsx'
import ModulePage from './pages/ModulePage.jsx'
import NotFound from './pages/NotFound.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="p/:projectId" element={<ProjectPage />} />
        <Route path="p/:projectId/:moduleId" element={<ModulePage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
