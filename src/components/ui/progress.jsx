import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import LoadingLottie from "./loading-lottie"

import { cn } from "@/lib/utils"

const Progress = React.forwardRef(({ className, value, message, ...props }, ref) => (
  <div className="flex flex-col items-center justify-center min-h-screen">
    <div className="text-center mb-4">
      <LoadingLottie 
        src="https://lottie.host/51fee83a-3e79-41b0-8a20-77f890b9b6f1/iUangPxwIF.lottie"
        message={message}
        size="md"
      />
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
