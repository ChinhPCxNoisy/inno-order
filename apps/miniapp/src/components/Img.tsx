import { useState } from 'react';

interface ImgProps {
  src: string;
  alt?: string;
  className?: string;
  /** Neu anh tai that bai: hien div chua ky tu nay (VD: chu cai dau ten quan/mon) */
  fallbackChar?: string;
  /** Class cho div fallback (mac dinh dung className) */
  fallbackClassName?: string;
  /** Bam / Enter / Space vao anh thi chay (anh thanh nut: role=button, focus duoc bang ban phim) */
  onActivate?: () => void;
}

/** Anh co fallback: loi URL thi hien ky tu (neu co) hoac an di, khong hien icon anh hong. */
export default function Img({ src, alt = '', className, fallbackChar, fallbackClassName, onActivate }: ImgProps) {
  const [failed, setFailed] = useState(false);

  const interactive = onActivate
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: onActivate,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate();
          }
        },
      }
    : {};

  if (!src || failed) {
    if (!fallbackChar) return null;
    return (
      <div className={fallbackClassName ?? className} aria-label={onActivate ? alt : undefined} {...interactive}>
        {fallbackChar}
      </div>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      {...interactive}
    />
  );
}
