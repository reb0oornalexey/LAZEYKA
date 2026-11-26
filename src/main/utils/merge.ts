// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isObject(item: any): item is Record<string, unknown> {
  return !!item && typeof item === 'object' && !Array.isArray(item)
}

function trimWrap(str: string): string {
  if (str.startsWith('<') && str.endsWith('>')) {
    return str.slice(1, -1)
  }
  return str
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Слияние без побочных эффектов: аргументы не меняются, результат — новый
 * объект. Раньше функция писала прямо в `target`, и после первого чтения
 * конфига объект умолчаний уже содержал настройки пользователя, отчего
 * «Сбросить настройки» записывал их обратно.
 *
 * Правила те же, что были:
 *  - вложенные объекты сливаются рекурсивно;
 *  - массивы и простые значения из `other` заменяют прежние;
 *  - ключ с «!» на конце («appearance!») заменяет объект целиком;
 *  - «<key>» читается как «key».
 * Неизменённые вложенные объекты переиспользуются (не копируются) — менять
 * результат на месте поэтому всё равно нельзя.
 */
export function deepMerge<T extends object>(target: T, other: Partial<T>): T {
  const out: Record<string, unknown> = isObject(target) ? { ...target } : {}
  if (!isObject(other)) return out as T
  for (const key of Object.keys(other)) {
    if (FORBIDDEN.has(key)) continue
    const value = (other as Record<string, unknown>)[key]
    if (key.endsWith('!')) {
      const k = trimWrap(key.slice(0, -1))
      if (FORBIDDEN.has(k)) continue
      out[k] = value
      continue
    }
    const k = trimWrap(key)
    if (FORBIDDEN.has(k)) continue
    if (isObject(value)) {
      out[k] = deepMerge(isObject(out[k]) ? (out[k] as object) : {}, value)
    } else {
      out[k] = value
    }
  }
  return out as T
}
