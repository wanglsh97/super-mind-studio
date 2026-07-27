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
      width={340}
      height={340}
      className={className}
      draggable={false}
    />
  )
}
