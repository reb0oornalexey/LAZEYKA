// Текстовые файлы, подключаемые в бандл как строки (vite `?raw`): shell-скрипты службы Zapret на macOS.
declare module '*.sh?raw' {
  const content: string
  export default content
}
