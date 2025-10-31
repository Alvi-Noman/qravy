// apps/tastebud/src/utils/item-resolver.ts

export type MenuIndexItem = {
  id: string
  name: string
  aliases?: string[]
}

/**
 * Build an in-memory searchable index for menu items.
 * Maps normalized names & aliases → canonical item IDs.
 */
export function buildMenuIndex(items: MenuIndexItem[]) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const byKey = new Map<string, string>() // normalized name/alias -> id

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

  for (const it of items) {
    if (it.name) byKey.set(norm(it.name), it.id)
    for (const a of it.aliases ?? []) {
      byKey.set(norm(a), it.id)
    }
  }

  return { byId, byKey, norm }
}

/**
 * Resolve a menu item ID by its name or alias.
 * Returns null if no match found.
 */
export function resolveItemIdByName(index: ReturnType<typeof buildMenuIndex>, name: string) {
  if (!name) return null
  const id = index.byKey.get(index.norm(name))
  return id ?? null
}
