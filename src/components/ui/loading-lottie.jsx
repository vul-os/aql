import React from 'react';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { cn } from '@/lib/utils';

/**
 * LoadingLottie - Professional Lottie animation loader
 * 
 * HOW TO FIND ANIMATIONS:
 * 1. Go to https://lottiefiles.com/
 * 2. Search for animations (robot, loading, tech, etc.)
 * 3. Click on one you like
 * 4. Click "Lottie Animation URL" or "Embed"
 * 5. Copy the URL (looks like: https://lottie.host/xxx/xxx.lottie)
 * 6. Use it in the 'src' prop!
 * 
 * USAGE:
 * <LoadingLottie 
 *   src="https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie"
 *   message="Loading..." 
 *   size="lg"
 * />
 */
const LoadingLottie = ({ 
  src,
  message, 
  size = 'md',
  loop = true,
  autoplay = true,
  className 
}) => {
  const sizes = {
    sm: 'w-32 h-32',
    md: 'w-48 h-48',
    lg: 'w-64 h-64',
    xl: 'w-96 h-96'
  };

  if (!src) {
    return (
      <div className={cn("flex flex-col items-center justify-center", className)}>
        <div className="text-center p-8 border-2 border-dashed border-muted rounded-lg max-w-md">
          <p className="text-muted-foreground mb-2 font-semibold">⚠️ No animation URL provided</p>
          <p className="text-xs text-muted-foreground mb-4">
            Go to lottiefiles.com, find an animation, and copy the URL
          </p>
          <code className="text-xs bg-muted p-2 rounded block">
            {'<LoadingLottie src="https://lottie.host/..." />'}
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center justify-center gap-4", className)}>
      <div className={cn(sizes[size])}>
        <DotLottieReact
          src={src}
          loop={loop}
          autoplay={autoplay}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      
      {message && (
        <div className="text-center space-y-2">
          <p className="text-lg font-medium text-foreground">{message}</p>
          <div className="flex items-center justify-center gap-1">
            <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      )}
    </div>
  );
};

export default LoadingLottie;
