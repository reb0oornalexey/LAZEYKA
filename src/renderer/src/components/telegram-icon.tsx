import React from 'react'
import { Send, type LucideProps } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

const TelegramIcon: React.FC<LucideProps> = ({ className, ...rest }) => (
  <Send className={cn('shrink-0', className)} {...rest} />
)

export default TelegramIcon
