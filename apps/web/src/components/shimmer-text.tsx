import type { ReactNode } from 'react'

import { cn } from '@/utils/cn'

export function ShimmerText({
  children,
  className,
}: Readonly<{
  children: ReactNode
  className?: string
}>) {
  return <span className={cn('text-shimmer-sweep', className)}>{children}</span>
}
