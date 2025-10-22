import React from 'react';
import { cn } from '@/lib/utils';

/**
 * LoadingMowerSimple - A simpler, more minimal version of the mower animation
 * Use this if you want something less detailed but still on-brand
 * 
 * Props:
 * - message: Optional loading message to display
 * - size: 'sm' | 'md' | 'lg' - Size of the animation (default: 'md')
 * - className: Additional CSS classes
 */
const LoadingMowerSimple = ({ message, size = 'md', className }) => {
  const sizes = {
    sm: 'w-24 h-24',
    md: 'w-32 h-32',
    lg: 'w-48 h-48'
  };

  return (
    <div className={cn("flex flex-col items-center justify-center", className)}>
      <div className={cn("relative", sizes[size])}>
        {/* Simple animated mower icon */}
        <svg 
          className="w-full h-full animate-mower-bounce" 
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Grass line */}
          <line 
            x1="0" 
            y1="70" 
            x2="100" 
            y2="70" 
            stroke="currentColor" 
            strokeWidth="2" 
            className="text-green-600/40"
            strokeDasharray="5,5"
          >
            <animate 
              attributeName="stroke-dashoffset" 
              from="0" 
              to="10" 
              dur="0.5s" 
              repeatCount="indefinite"
            />
          </line>
          
          {/* Mower body */}
          <rect
            x="35"
            y="45"
            width="30"
            height="20"
            rx="3"
            fill="currentColor"
            className="text-gray-700 dark:text-gray-300"
          />
          
          {/* Green accent */}
          <rect
            x="38"
            y="48"
            width="24"
            height="6"
            rx="2"
            fill="currentColor"
            className="text-green-600"
          />
          
          {/* Antenna with pulsing dot */}
          <line
            x1="42"
            y1="45"
            x2="42"
            y2="38"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-gray-700 dark:text-gray-300"
          />
          <circle
            cx="42"
            cy="36"
            r="2.5"
            fill="currentColor"
            className="text-orange-500 animate-pulse"
          />
          
          {/* Wheels */}
          <circle
            cx="40"
            cy="65"
            r="4"
            fill="currentColor"
            className="text-gray-600 dark:text-gray-400"
          >
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="rotate"
              from="0 40 65"
              to="360 40 65"
              dur="0.5s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            cx="60"
            cy="65"
            r="4"
            fill="currentColor"
            className="text-gray-600 dark:text-gray-400"
          >
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="rotate"
              from="0 60 65"
              to="360 60 65"
              dur="0.5s"
              repeatCount="indefinite"
            />
          </circle>
          
          {/* Cutting blade indicator */}
          <circle
            cx="50"
            cy="62"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-gray-500/30"
          >
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="rotate"
              from="0 50 62"
              to="360 50 62"
              dur="0.8s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>

        {/* Progress arc */}
        <svg 
          className="absolute inset-0 w-full h-full -rotate-90" 
          viewBox="0 0 100 100"
        >
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-green-600/20"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-green-600"
            strokeDasharray="283"
            strokeDashoffset="283"
            strokeLinecap="round"
          >
            <animate
              attributeName="stroke-dashoffset"
              from="283"
              to="0"
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
      </div>

      {/* Loading message */}
      {message && (
        <div className="mt-4 text-center">
          <p className="text-base font-medium text-foreground">{message}</p>
        </div>
      )}
    </div>
  );
};

export default LoadingMowerSimple;


