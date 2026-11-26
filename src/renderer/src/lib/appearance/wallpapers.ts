import anime from '@renderer/assets/wallpapers/anime.webp?url'
import crimson from '@renderer/assets/wallpapers/crimson.webp?url'
import orange from '@renderer/assets/wallpapers/orange.webp?url'

export interface BuiltinWallpaper {
  id: string
  category: string
  name: string
  src: string
}

/** Встроенные обои. Хранятся в настройках как `builtin:<имя>`; картинки лежат отдельными файлами рядом с бандлом (не base64 внутри JS). */
export const BUILTIN_WALLPAPERS: BuiltinWallpaper[] = [
  { id: 'builtin:anime', category: 'Аниме', name: 'Ночной город', src: anime },
  { id: 'builtin:crimson', category: 'Аниме', name: 'Багровый взгляд', src: crimson },
  { id: 'builtin:orange', category: 'Сумрак', name: 'Оранжевое свечение', src: orange }
]

export const builtinById = (id: string): BuiltinWallpaper | undefined => BUILTIN_WALLPAPERS.find((w) => w.id === id)
