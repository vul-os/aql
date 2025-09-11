import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

const Progress = React.forwardRef(({ className, value, message, ...props }, ref) => (
  <div className="flex flex-col items-center justify-center min-h-screen">
    <div className="text-center mb-4">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
      {message && (
        <p className="text-gray-600 text-lg">{message}</p>
      )}
    </div>
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "relative h-2 w-full max-w-xs overflow-hidden rounded-full bg-primary/20",
        className
      )}
      {...props}>
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }} />
    </ProgressPrimitive.Root>
  </div>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
