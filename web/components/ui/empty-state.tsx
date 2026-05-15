import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { type LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: { label: string; href?: string; onClick?: () => void; icon?: LucideIcon }
  secondaryAction?: { label: string; href?: string; onClick?: () => void }
  variant?: 'default' | 'search' | 'success'
  size?: 'sm' | 'md' | 'lg'
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  variant = 'default',
  size = 'md',
}: EmptyStateProps) {
  const sizes = {
    sm: { wrap: 'py-10',  iconBox: 'w-12 h-12 rounded-2xl', iconSize: 'w-6 h-6',  title: 'text-sm font-bold' },
    md: { wrap: 'py-16',  iconBox: 'w-16 h-16 rounded-2xl', iconSize: 'w-8 h-8',  title: 'text-base font-bold' },
    lg: { wrap: 'py-24',  iconBox: 'w-20 h-20 rounded-3xl', iconSize: 'w-10 h-10',title: 'text-lg font-bold' },
  }
  const s = sizes[size]

  const variantClasses = {
    default: 'bg-gradient-to-br from-brand-100 to-brand-200 text-brand-500',
    search:  'bg-gradient-to-br from-gray-100 to-gray-200 text-gray-400',
    success: 'bg-gradient-to-br from-green-100 to-emerald-200 text-green-500',
  }

  const renderAction = () => {
    if (!action) return null
    const ActionIcon = action.icon
    const content = (
      <Button size={size === 'sm' ? 'sm' : 'default'} className="gap-2">
        {ActionIcon && <ActionIcon className="w-4 h-4" />}
        {action.label}
      </Button>
    )
    if (action.href) return <Link href={action.href}>{content}</Link>
    return <button type="button" onClick={action.onClick}>{content}</button>
  }

  const renderSecondary = () => {
    if (!secondaryAction) return null
    const content = <button type="button" className="text-sm text-surface-muted hover:text-gray-700 underline-offset-2 hover:underline">{secondaryAction.label}</button>
    if (secondaryAction.href) return <Link href={secondaryAction.href}>{content}</Link>
    return <button type="button" onClick={secondaryAction.onClick} className="text-sm text-surface-muted hover:text-gray-700 underline-offset-2 hover:underline">{secondaryAction.label}</button>
  }

  return (
    <div className={`flex flex-col items-center justify-center text-center ${s.wrap}`}>
      <div className={`${s.iconBox} ${variantClasses[variant]} flex items-center justify-center mb-4 shadow-sm`}>
        <Icon className={s.iconSize} />
      </div>
      <p className={`${s.title} text-gray-900 mb-1`}>{title}</p>
      {description && <p className="text-sm text-surface-muted max-w-md mb-5">{description}</p>}
      <div className="flex items-center gap-3">
        {renderAction()}
        {renderSecondary()}
      </div>
    </div>
  )
}
