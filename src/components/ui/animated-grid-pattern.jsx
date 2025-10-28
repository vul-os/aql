import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export function AnimatedGridPattern({
  width = 40,
  height = 40,
  x = -1,
  y = -1,
  strokeDasharray = 0,
  numSquares = 50,
  className,
  maxOpacity = 0.5,
  duration = 4,
  repeatDelay = 0.5,
  ...props
}) {
  const id = useId();
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [squares, setSquares] = useState(() => generateSquares(numSquares));

  function getPos() {
    return [
      Math.floor((Math.random() * dimensions.width) / width),
      Math.floor((Math.random() * dimensions.height) / height)
    ];
  }

  // Generate random squares for the pattern
  function generateSquares(count) {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      pos: getPos()
    }));
  }

  // Adjust squares when container size changes
  const updateSquares = () => {
    if (dimensions.width && dimensions.height) {
      setSquares(generateSquares(numSquares));
    }
  };

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setDimensions({ width, height });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);

    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  useEffect(() => {
    updateSquares();
  }, [dimensions, numSquares]);

  return (
    <svg
      ref={containerRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full fill-gray-400/30 stroke-gray-400/30',
        className
      )}
      {...props}
    >
      <defs>
        <pattern
          id={id}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          x={x}
          y={y}
        >
          <path
            d={`M.5 ${height}V.5H${width}`}
            fill="none"
            strokeDasharray={strokeDasharray}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      <svg x={x} y={y} className="overflow-visible">
        {squares.map(({ pos: [x, y], id }, index) => (
          <rect
            key={`${id}-${index}`}
            width={width - 1}
            height={height - 1}
            x={x * width + 1}
            y={y * height + 1}
            fill="currentColor"
            strokeWidth="0"
            className={cn('animate-pulse')}
            style={{
              animationDelay: `${index * 0.1}s`,
              animationDuration: `${duration}s`,
              animationFillMode: 'both',
              opacity: 0
            }}
          >
            <animate
              attributeName="opacity"
              begin={`${index * repeatDelay}s`}
              dur={`${duration}s`}
              values={`0;${maxOpacity};0`}
              calcMode="spline"
              keySplines="0.4 0 0.6 1; 0.4 0 0.6 1"
              repeatCount="indefinite"
            />
          </rect>
        ))}
      </svg>
    </svg>
  );
}

