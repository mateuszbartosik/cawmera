import { store, useApp } from '../app/store'

export function useSection(id: string) {
  const collapsed = useApp((s) => !!s.collapsed[id])
  const toggle = () => store.set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } }))
  return { collapsed, onToggle: toggle }
}
