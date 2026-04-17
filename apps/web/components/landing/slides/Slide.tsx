'use client';

import sharedStyles from './Slide.module.css';

export interface SlideProps {
  isActive: boolean;
  index: number;
  currentIndex: number;
}

interface SlideShellProps extends SlideProps {
  children: React.ReactNode;
  className?: string;
}

export default function Slide({
  isActive,
  index,
  children,
  className,
}: SlideShellProps) {
  return (
    <section
      className={`${sharedStyles.slide} ${isActive ? sharedStyles.slideActive : ''} ${className ?? ''}`}
      data-slide-index={index}
    >
      {children}
    </section>
  );
}
