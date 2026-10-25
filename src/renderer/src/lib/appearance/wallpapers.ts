import anime from '@renderer/assets/wallpapers/anime.webp?inline'
import crimson from '@renderer/assets/wallpapers/crimson.webp?inline'
import orange from '@renderer/assets/wallpapers/orange.webp?inline'

export interface BuiltinWallpaper {
  id: string
  category: string
  name: string
  src: string
}

/** Встроенные обои. Хранятся в настройках как `builtin:<имя>`; картинки вшиты в приложение. */
export const BUILTIN_WALLPAPERS: BuiltinWallpaper[] = [
  { id: 'builtin:anime', category: 'Аниме', name: 'Ночной город', src: anime },
  { id: 'builtin:crimson', category: 'Аниме', name: 'Багровый взгляд', src: crimson },
  { id: 'builtin:orange', category: 'Сумрак', name: 'Оранжевое свечение', src: orange }
]

export const builtinById = (id: string): BuiltinWallpaper | undefined => BUILTIN_WALLPAPERS.find((w) => w.id === id)
