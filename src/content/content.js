// Все данные собираются при сборке: Vite находит файлы по маске и встраивает их в бандл.
const projectFiles = import.meta.glob('./*/project.json', { eager: true, import: 'default' })
const moduleFiles = import.meta.glob('./*/modules/*.json', { eager: true, import: 'default' })
const theoryFiles = import.meta.glob('./*/modules/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

export const LEVEL_LABELS = {
  beginner: 'базовый',
  intermediate: 'средний',
  advanced: 'продвинутый',
}

export function getProject(projectId) {
  const project = projectFiles[`./${projectId}/project.json`]
  if (!project) return null

  const modules = [...project.modules]
    .sort((a, b) => a.order - b.order)
    .map((m) => ({ ...m, ready: Boolean(moduleFiles[`./${projectId}/modules/${m.id}.json`]) }))

  return { ...project, modules }
}

export function getModule(projectId, moduleId) {
  const project = getProject(projectId)
  if (!project) return null

  const index = project.modules.findIndex((m) => m.id === moduleId)
  if (index === -1) return null

  const meta = project.modules[index]
  const data = moduleFiles[`./${projectId}/modules/${moduleId}.json`] ?? null
  const theory = data ? (theoryFiles[`./${projectId}/modules/${data.theoryFile}`] ?? '') : ''

  return {
    project,
    meta,
    data,
    theory,
    prev: project.modules[index - 1] ?? null,
    next: project.modules[index + 1] ?? null,
  }
}
