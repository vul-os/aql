import React from 'react';
import { cn } from '@/lib/utils';

/**
 * LoadingMower - An animated robotic lawn mower loading indicator
 * Perfect for BotKorp branding!
 * 
 * Props:
 * - message: Optional loading message to display
 * - size: 'sm' | 'md' | 'lg' - Size of the animation (default: 'md')
 * - className: Additional CSS classes
 */
const LoadingMower = ({ message, size = 'md', className }) => {
  const sizes = {
    sm: 'w-32 h-32',
    md: 'w-48 h-48',
    lg: 'w-64 h-64'
  };

  return (
    <div className={cn("flex flex-col items-center justify-center", className)}>
      <div className={cn("relative", sizes[size])}>
        {/* Grass being cut effect */}
        <svg 
          className="absolute inset-0 w-full h-full" 
          viewBox="0 0 200 200"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Ground line */}
          <line 
            x1="0" 
            y1="140" 
            x2="200" 
            y2="140" 
            stroke="currentColor" 
            strokeWidth="2" 
            className="text-green-600/30"
          />
          
          {/* Animated grass blades (uncut) */}
          <g className="text-green-500">
            {[...Array(8)].map((_, i) => (
              <line
                key={`grass-${i}`}
                x1={25 + i * 25}
                y1={140}
                x2={25 + i * 25}
                y2={120}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="animate-sway"
                style={{
                  animationDelay: `${i * 0.1}s`,
                  transformOrigin: `${25 + i * 25}px 140px`
                }}
              />
            ))}
          </g>

          {/* Cut grass trail (fading) */}
          <g className="animate-fade-trail">
            {[...Array(5)].map((_, i) => (
              <rect
                key={`cut-${i}`}
                x={10 + i * 15}
                y={138}
                width="10"
                height="4"
                fill="currentColor"
                className="text-green-300/40"
                opacity={1 - i * 0.15}
              />
            ))}
          </g>

          {/* Robotic Lawn Mower */}
          <g className="animate-mower-move">
            {/* Mower body */}
            <rect
              x="80"
              y="110"
              width="40"
              height="25"
              rx="4"
              fill="currentColor"
              className="text-gray-800 dark:text-gray-200"
            />
            
            {/* Top panel/display */}
            <rect
              x="85"
              y="115"
              width="30"
              height="8"
              rx="2"
              fill="currentColor"
              className="text-green-600"
            />
            
            {/* LED indicator (blinking) */}
            <circle
              cx="110"
              cy="119"
              r="2"
              fill="currentColor"
              className="text-green-400 animate-pulse"
            />
            
            {/* Wheels */}
            <circle
              cx="88"
              cy="135"
              r="5"
              fill="currentColor"
              className="text-gray-600 dark:text-gray-400 animate-spin-wheel"
            />
            <circle
              cx="112"
              cy="135"
              r="5"
              fill="currentColor"
              className="text-gray-600 dark:text-gray-400 animate-spin-wheel"
            />
            
            {/* Cutting blade indicator (spinning) */}
            <g className="animate-spin-fast" style={{ transformOrigin: '100px 128px' }}>
              <line x1="95" y1="128" x2="105" y2="128" stroke="currentColor" strokeWidth="2" className="text-gray-500" />
              <line x1="100" y1="123" x2="100" y2="133" stroke="currentColor" strokeWidth="2" className="text-gray-500" />
            </g>

            {/* Antenna */}
            <line
              x1="90"
              y1="110"
              x2="90"
              y2="105"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-gray-700 dark:text-gray-300"
            />
            <circle
              cx="90"
              cy="103"
              r="2"
              fill="currentColor"
              className="text-orange-500 animate-ping"
              style={{ animationDuration: '2s' }}
            />
            <circle
              cx="90"
              cy="103"
              r="2"
              fill="currentColor"
              className="text-orange-500"
            />
          </g>

          {/* Cutting effect particles */}
          <g className="animate-particles">
            {[...Array(3)].map((_, i) => (
              <circle
                key={`particle-${i}`}
                cx={95 + i * 5}
                cy={130 + i * 2}
                r="1"
                fill="currentColor"
                className="text-green-400"
                opacity={0.6}
              />
            ))}
          </g>
        </svg>
      </div>

      {/* Loading message */}
      {message && (
        <div className="mt-4 text-center space-y-2">
          <p className="text-lg font-medium text-foreground">{message}</p>
          <div className="flex items-center justify-center gap-1">
            <div className="w-2 h-2 bg-green-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-green-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-green-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      )}
    </div>
  );
};

export default LoadingMower;


