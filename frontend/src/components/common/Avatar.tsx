import styles from './Avatar.module.css';

interface AvatarProps {
  size?: number;
  borderWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function Avatar({ size = 36, borderWidth = 2, className, style }: AvatarProps) {
  return (
    <div
      className={`${styles.avatar} ${className ?? ''}`}
      style={{ width: size, height: size, borderWidth, ...style }}
    >
      <img src="/assets/mascot-avatar.png" alt="QBot" />
    </div>
  );
}
