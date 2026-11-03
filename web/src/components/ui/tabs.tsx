import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

/** Emergent folder tabs: a hairline baseline with raised metal tabs that sit on it. */
export const TabsList = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex h-9 items-end justify-start gap-1 border-b border-border text-muted-foreground', className)}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      '-mb-px inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-t-lg border border-transparent px-3 text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5',
      'data-[state=active]:border-border data-[state=active]:border-b-transparent data-[state=active]:bg-gradient-to-b data-[state=active]:from-[hsl(var(--metal-raised-hi))] data-[state=active]:to-[hsl(var(--metal-hi))] data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_1px_0_hsl(var(--metal-highlight))]',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('focus-visible:outline-none data-[state=active]:animate-fade-up', className)} {...props} />
));
TabsContent.displayName = 'TabsContent';
