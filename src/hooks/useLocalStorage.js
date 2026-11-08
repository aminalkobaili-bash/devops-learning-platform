import { useEffect, useState } from 'react'

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    // приватный режим или битый JSON — работаем без сохранения
    return fallback
  }
}

// useState, который переживает перезагрузку страницы.
export default function useLocalStorage(key, fallback) {
  const [value, setValue] = useState(() => read(key, fallback))

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // хранилище недоступно — состояние живёт только до перезагрузки
    }
  }, [key, value])

  return [value, setValue]
}
