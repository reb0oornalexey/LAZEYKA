import React from 'react'
import type { IngestPlatform } from '@renderer/utils/streamer-api'
import {
  DiscordBrandIcon,
  KickBrandIcon,
  OBSBrandIcon,
  TwitchBrandIcon,
  YouTubeBrandIcon
} from '@renderer/components/service-icons'

/**
 * Значки площадок для страницы «Стример». Раньше здесь были одноцветные силуэты,
 * теперь — фирменные цветные значки из общего набора service-icons (thesvg, без сети).
 * Имена экспорта прежние, чтобы не менять места использования.
 */
type P = { className?: string }

export const TwitchIcon: React.FC<P> = ({ className }) => <TwitchBrandIcon className={className} />

export const YouTubeIcon: React.FC<P> = ({ className }) => <YouTubeBrandIcon className={className} />

export const KickIcon: React.FC<P> = ({ className }) => <KickBrandIcon className={className} />

export const DiscordIcon: React.FC<P> = ({ className }) => <DiscordBrandIcon className={className} />

export const ObsIcon: React.FC<P> = ({ className }) => <OBSBrandIcon className={className} />

export const PlatformIcon: React.FC<{ platform: IngestPlatform; className?: string }> = ({ platform, className }) => {
  if (platform === 'twitch') return <TwitchIcon className={className} />
  if (platform === 'youtube') return <YouTubeIcon className={className} />
  if (platform === 'kick') return <KickIcon className={className} />
  return <span className={className} />
}
