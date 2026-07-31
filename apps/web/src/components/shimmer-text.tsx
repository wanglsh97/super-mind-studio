'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/utils/cn'

export default function ShimmerText({
  children,
  className,
}: Readonly<{
  children: ReactNode
  className?: string
}>) {
  const ref = useRef<HTMLSpanElement>(null)
  const [duration, setDuration] = useState(3.2)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const updateDuration = () => {
      const width = element.getBoundingClientRect().width
      setDuration(Math.max(3.2, (width + 160) / 180))
    }

    updateDuration()
    const observer = new ResizeObserver(updateDuration)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <span
      ref={ref}
      className={cn('text-shimmer-sweep', className)}
      style={{ '--text-shimmer-duration': `${duration}s` } as CSSProperties}
    >
      {children}
    </span>
  )
}
