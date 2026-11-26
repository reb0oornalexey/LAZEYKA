import { getAppVersion } from './ipc'
// const originError = console.error

export const platform: NodeJS.Platform = window.api.platform

export const linuxUnavailableRoutes = new Set(['/prematch', '/optimizer', '/tweaks'])
export let version: string = ''

export async function init(): Promise<void> {
  version = await getAppVersion()
}
