import Image from 'next/image'

type BrandMarkProps = Readonly<{
  alt?: string
  className?: string
}>

export function BrandMark({ alt = '', className }: BrandMarkProps) {
  return (
    <Image
      src="/brand/super-mind-studio-mark.png"
      alt={alt}
      width={380}
      height={380}
      className={className}
      draggable={false}
    />
  )
}
