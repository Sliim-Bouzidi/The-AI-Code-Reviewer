import * as React from 'react';

export default function PageContainer({
  title,
  description,
  action,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className='flex min-w-0 flex-1 flex-col gap-4 px-4 pt-2 pb-6 md:px-6 md:pt-4'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='min-w-0'>
          <h1 className='truncate text-2xl font-semibold tracking-tight'>{title}</h1>
          {description && <p className='text-muted-foreground mt-1 text-sm'>{description}</p>}
        </div>
        {action && <div className='shrink-0'>{action}</div>}
      </div>
      {children}
    </div>
  );
}
