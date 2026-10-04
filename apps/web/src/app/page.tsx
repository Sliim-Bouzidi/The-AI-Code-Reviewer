import {
  IconArrowDown,
  IconArrowRight,
  IconBrandDiscord,
  IconBrandDocker,
  IconBrandGithub,
  IconBrandNextjs,
  IconBrandPython,
  IconBrandReact,
  IconBrandTypescript,
  IconBrandX,
  IconCheck,
  IconCode,
  IconCpu,
  IconGitPullRequest,
  IconShieldCheck,
  IconSparkles,
} from '@tabler/icons-react';
import Link from 'next/link';
import { AnimatedHeroTitle } from '@/components/animated-hero-title';
import { AvatarSocialProof } from '@/components/avatar-stack';
import { PlaceCard } from '@/components/place-card';
import { SetupSteps } from '@/components/setup-steps';
import { TypingAnimation } from '@/components/typing-animation';
import { ChartBarMixed } from '@/components/chart-bar-mixed';
import { MarkerHighlight } from '@/components/marker-highlight';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

// Reviews Data for Infinite Moving Marquee
const reviewsRow1 = [
  {
    quote:
      'As an engineering founder, I spent hours reviewing PRs that blocked releases. With AI Code Reviewer, our team merges with complete certainty in hours.',
    author: 'Duke Opoku Amankwah',
    title: 'Founder @ Midas',
    avatar: 'DA',
  },
  {
    quote:
      'The architectural awareness is unbelievable. It caught an asynchronous cache race condition before our code ever hit staging.',
    author: 'Abiola Braimah',
    title: 'Tech Lead @ Studio IX',
    avatar: 'AB',
  },
  {
    quote:
      'Beautiful comments with exact tone and actionable diffs. The micro-interactions make this the best developer tool we adopted this year.',
    author: 'Alan Obeng-Peprah',
    title: 'Senior Architect @ NativeXAI',
    avatar: 'AO',
  },
  {
    quote:
      'Outstanding attention to detail. It understands multi-package dependencies in our monorepo and respects our custom repo guidelines.',
    author: 'Acromond X.',
    title: 'Co-founder @ Vectorlabs',
    avatar: 'AX',
  },
];

const reviewsRow2 = [
  {
    quote:
      'Integrating this into our GitHub pipeline reduced review cycle times by 65%. It feels like having an attentive principal architect on call 24/7.',
    author: 'Raquib S.',
    title: 'Backend Architect',
    avatar: 'RS',
  },
  {
    quote:
      'The security analysis caught a subtle JWT bypass that escaped our traditional static analyzers. This tool has paid for itself a hundred times over.',
    author: 'Hallic M.',
    title: 'Security Engineer',
    avatar: 'HM',
  },
  {
    quote:
      'Every comment includes why, the architectural risk, and the patch. Our junior engineers learn more from the PR reviews than anywhere else.',
    author: 'Desmond Vance',
    title: 'Director of Engineering',
    avatar: 'DV',
  },
  {
    quote:
      'Zero configuration required. We installed the GitHub App and within 30 seconds our active pull requests had high-signal findings.',
    author: 'Elena Rostova',
    title: 'Staff Platform Engineer',
    avatar: 'ER',
  },
];

export default function HomePage() {
  return (
    <main
      id='top'
      className='min-h-screen bg-black text-[#ededed] relative overflow-x-hidden selection:bg-white/20 selection:text-white font-sans before:absolute before:inset-0 before:pointer-events-none before:bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] before:bg-[size:48px_48px] before:z-0'
    >
      {/* ================= HEADER / FLOATING NAVBAR ================= */}
      <header className='fixed top-0 left-0 right-0 z-50 h-16 border-b border-white/[0.08] bg-black/75 backdrop-blur-xl transition-all'>
        <div className='max-w-7xl mx-auto h-full px-6 flex items-center justify-between'>
          <Link href='/' className='flex items-center gap-2 text-white font-semibold text-sm tracking-tight'>
            <span className='flex items-center justify-center w-7 h-7 rounded-lg bg-white text-black'>
              <IconCode className='w-4 h-4' />
            </span>
            <span className='font-semibold tracking-tight'>AI Code Reviewer</span>
          </Link>

          <nav className='hidden md:flex items-center gap-1 p-1 rounded-full bg-white/[0.03] border border-white/[0.08] backdrop-blur-md'>
            <a href='#services' className='px-3.5 py-1.5 rounded-full text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors'>
              Services
            </a>
            <a href='#stack' className='px-3.5 py-1.5 rounded-full text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors'>
              Ecosystem
            </a>
            <a href='#preview' className='px-3.5 py-1.5 rounded-full text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors'>
              Inspection
            </a>
            <a href='#testimonials' className='px-3.5 py-1.5 rounded-full text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors'>
              Reviews
            </a>
            <a href='#workflow' className='px-3.5 py-1.5 rounded-full text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors'>
              Workflow
            </a>
          </nav>

          <div className='flex items-center gap-2'>
            <Link href='/sign-in'>
              <Button variant='ghost' size='sm' className='rounded-full text-xs text-neutral-400 hover:text-white'>
                Sign in
              </Button>
            </Link>
            <Link href='/dashboard'>
              <Button variant='default' size='sm' className='rounded-full px-4 text-xs font-medium bg-white text-black hover:bg-white/90'>
                Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ================= HERO SECTION (LIGHTBOX STYLE + 3D VIDEO BG) ================= */}
      <section className='relative min-h-[92vh] flex flex-col items-center justify-center text-center px-6 pt-28 pb-20 overflow-hidden z-10'>
        {/* Background 3D Video Loop */}
        <div className='absolute inset-0 pointer-events-none overflow-hidden -z-10 flex items-center justify-center' aria-hidden='true'>
          <video
            className='w-full h-full object-cover opacity-85 contrast-[1.15] brightness-[1.02] scale-105'
            autoPlay
            loop
            muted
            playsInline
            preload='auto'
          >
            <source src='/hero-bg.mp4' type='video/mp4' />
          </video>
          {/* Edge vignette fading seamlessly into pure black */}
          <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.1)_15%,rgba(0,0,0,0.7)_60%,#000000_92%)] before:absolute before:inset-0 before:bg-gradient-to-b before:from-black/90 before:via-transparent before:to-black' />
        </div>

        {/* Center Copy with Framer Motion & GSAP Animated Typography (No capsule badge above) */}
        <div className='relative z-10 max-w-4xl mx-auto flex flex-col items-center'>
          <AnimatedHeroTitle />

          <p className='mt-6 mb-9 text-neutral-400 text-base sm:text-lg md:text-xl max-w-2xl mx-auto leading-relaxed text-balance'>
            Revolutionizing code quality, architectural consistency, and team velocity—one intelligent decision at a time.
          </p>

          <div className='flex items-center justify-center gap-4 flex-wrap'>
            {/* THE ONE AND ONLY COLORED ANIMATED GLOW BUTTON (BUTTON 33 STYLE) - 100% TAILWIND CSS */}
            <Link
              href='/dashboard'
              className='group relative inline-flex items-center justify-center p-[1.5px] rounded-full overflow-hidden shadow-[0_0_24px_-2px_rgba(139,92,246,0.5),0_0_40px_-6px_rgba(6,182,212,0.35),0_4px_16px_rgba(0,0,0,0.9)] hover:scale-[1.02] hover:shadow-[0_0_36px_0px_rgba(139,92,246,0.7),0_0_24px_2px_rgba(255,107,0,0.5)] active:scale-[0.98] transition-all duration-200 cursor-pointer isolate'
            >
              {/* Rotating Conic Gradient Border */}
              <span className='absolute -inset-[150%] bg-[conic-gradient(from_0deg,transparent_0deg,#ff6b00_40deg,#ffc44d_80deg,transparent_130deg,#06b6d4_180deg,#3b82f6_220deg,#a855f7_260deg,#ec4899_310deg,#ff6b00_360deg)] animate-spin-slow group-hover:[animation-duration:1.6s]' />
              {/* Core inner pill */}
              <span className='relative z-10 inline-flex items-center justify-center gap-2.5 px-7 py-3 rounded-full bg-[#08080a] group-hover:bg-[#111218] text-white text-sm font-medium tracking-tight transition-colors duration-200'>
                <IconSparkles className='w-4 h-4 text-amber-400 animate-pulse drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]' />
                <span>Start Reviewing Free</span>
              </span>
            </Link>

            {/* Clean Vercel Secondary Button (shadcn/ui Button) */}
            <Link href='#preview'>
              <Button
                variant='outline'
                size='lg'
                className='rounded-full h-11 px-6 text-sm gap-2 border-white/15 bg-black/40 backdrop-blur hover:bg-white/10 text-neutral-200 hover:text-white transition-all'
              >
                <span>View Live Inspection</span>
                <IconArrowRight size={15} />
              </Button>
            </Link>
          </div>
        </div>

        {/* Bottom capsule indicators matching Lightbox */}
        <div className='absolute bottom-6 left-0 right-0 px-8 max-w-7xl mx-auto hidden md:flex items-center justify-between text-xs text-neutral-500 pointer-events-auto'>
          <a
            href='#stack'
            className='inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.08] hover:border-white/20 text-neutral-400 hover:text-white backdrop-blur transition-all'
            aria-label='Scroll to explore'
          >
            <span className='w-5 h-5 rounded-full bg-white/10 flex items-center justify-center animate-bounce'>
              <IconArrowDown size={11} />
            </span>
            <span>Scroll to Discover</span>
          </a>

          <div className='inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.08] backdrop-blur text-neutral-400'>
            <span className='w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]' />
            <span>GitHub App v2.5 · Ready to review</span>
          </div>
        </div>
      </section>

      {/* ================= TECH STACK & ARCHITECTURE SECTION ("Review. Understand. Ship.") ================= */}
      <section id='stack' className='relative z-10 max-w-7xl mx-auto px-6 py-24 border-t border-white/[0.08]'>
        <div className='max-w-3xl'>
          <Badge variant='secondary' className='rounded-full px-3 py-0.5 text-xs font-mono tracking-wider uppercase bg-white/10 text-neutral-300'>
            System Intelligence
          </Badge>

          <h2 className='text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-white mt-4 mb-4 leading-tight'>
            Review. Understand.{' '}
            <span className='bg-gradient-to-r from-sky-400 via-indigo-300 to-sky-300 bg-clip-text text-transparent'>
              <TypingAnimation words={['Ship.', 'Scale.', 'Deploy.', 'Verify.']} />
            </span>
          </h2>

          <p className='text-neutral-400 text-base md:text-lg leading-relaxed mb-8'>
            AI Code Reviewer goes beyond surface-level linters. It indexes repository-wide abstract syntax trees, cross-file imports, and call hierarchies to provide the context your senior engineers wish they had during code review.
          </p>

          <div className='flex items-center gap-3 flex-wrap mb-9'>
            <Link href='/dashboard'>
              <Button size='lg' className='rounded-full px-6 h-11 gap-2 text-sm font-medium bg-white text-black hover:bg-white/90'>
                Connect GitHub Repositories <IconArrowRight size={15} />
              </Button>
            </Link>
            <Link href='#workflow'>
              <Button variant='outline' size='lg' className='rounded-full px-6 h-11 text-sm font-medium border-white/15 bg-white/[0.03] hover:bg-white/10 text-neutral-300'>
                How Architecture Works
              </Button>
            </Link>
          </div>

          {/* Ecosystem Chips (Shadcn Badges) */}
          <div className='flex flex-wrap items-center gap-2 pt-6 border-t border-white/[0.08]'>
            <Badge variant='outline' className='rounded-full px-3 py-1.5 text-xs font-medium gap-2 bg-white/[0.03] border-white/10 text-neutral-300 hover:bg-white/[0.08] transition-colors'>
              <IconBrandGithub size={14} className='text-neutral-400' /> GitHub App
            </Badge>
            <Badge variant='outline' className='rounded-full px-3 py-1.5 text-xs font-medium gap-2 bg-white/[0.03] border-white/10 text-neutral-300 hover:bg-white/[0.08] transition-colors'>
              <IconBrandNextjs size={14} className='text-neutral-400' /> Next.js
            </Badge>
            <Badge variant='outline' className='rounded-full px-3 py-1.5 text-xs font-medium gap-2 bg-white/[0.03] border-white/10 text-neutral-300 hover:bg-white/[0.08] transition-colors'>
              <IconBrandReact size={14} className='text-neutral-400' /> React
            </Badge>
            <Badge variant='outline' className='rounded-full px-3 py-1.5 text-xs font-medium gap-2 bg-white/[0.03] border-white/10 text-neutral-300 hover:bg-white/[0.08] transition-colors'>
              <IconBrandTypescript size={14} className='text-neutral-400' /> TypeScript
            </Badge>
            <Badge variant='outline' className='rounded-full px-3 py-1.5 text-xs font-medium gap-2 bg-white/[0.03] border-white/10 text-neutral-300 hover:bg-white/[0.08] transition-colors'>
              <IconBrandPython size={14} className='text-neutral-400' /> Python
            </Badge>
            <Badge variant='outline' className='rounded-full px-3 py-1.5 text-xs font-medium gap-2 bg-white/[0.03] border-white/10 text-neutral-300 hover:bg-white/[0.08] transition-colors'>
              <IconCpu size={14} className='text-neutral-400' /> Multi-Agent LLMs
            </Badge>
            <Badge variant='outline' className='rounded-full px-3 py-1.5 text-xs font-medium gap-2 bg-white/[0.03] border-white/10 text-neutral-300 hover:bg-white/[0.08] transition-colors'>
              <IconBrandDocker size={14} className='text-neutral-400' /> Monorepos
            </Badge>
            <Badge variant='outline' className='rounded-full px-3 py-1.5 text-xs font-medium gap-2 bg-white/[0.03] border-white/10 text-neutral-300 hover:bg-white/[0.08] transition-colors'>
              <IconShieldCheck size={14} className='text-neutral-400' /> Scoped Security
            </Badge>
          </div>
        </div>
      </section>

      {/* ================= PR REVIEW SURFACE PREVIEW ================= */}
      <section id='preview' className='relative z-10 max-w-7xl mx-auto px-6 py-20'>
        <div className='grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-12 items-center'>
          <div className='max-w-lg'>
            <Badge variant='secondary' className='rounded-full px-3 py-0.5 text-xs font-mono tracking-wider uppercase bg-white/10 text-neutral-300'>
              The Review Surface
            </Badge>
            <h2 className='text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mt-4 mb-4 leading-tight'>
              Clear feedback. Right in the pull request.
            </h2>
            <p className='text-neutral-400 text-base leading-relaxed mb-7'>
              Every comment includes concrete justification, surrounding architectural context, and a copy-paste solution. It behaves like a thoughtful, senior team member—not another noisy notification.
            </p>
            <Link href='/dashboard'>
              <Button size='default' className='rounded-full px-5 text-sm bg-white text-black hover:bg-white/90'>
                Inspect Your Repositories
              </Button>
            </Link>
          </div>

          {/* Realistic GitHub PR Review Card using Shadcn Card */}
          <Card className='border-white/10 bg-zinc-950/70 backdrop-blur-xl shadow-2xl overflow-hidden rounded-xl'>
            <CardHeader className='flex flex-row items-center justify-between border-b border-white/[0.08] py-3.5 px-4 bg-white/[0.02]'>
              <div className='flex items-center gap-2 font-medium text-sm text-white'>
                <IconGitPullRequest size={16} className='text-emerald-400' />
                <span>feat(auth): migrate to scoped session store #142</span>
              </div>
              <Badge variant='outline' className='rounded-full text-emerald-400 border-emerald-500/30 bg-emerald-500/10 text-xs font-semibold'>
                Review Ready
              </Badge>
            </CardHeader>

            <CardContent className='p-5'>
              <div className='flex items-center gap-2 text-xs font-mono text-neutral-400 mb-3'>
                <IconCode size={14} />
                <span>src/auth/session.ts</span>
                <span className='ml-auto text-emerald-400 font-semibold'>+12 −3</span>
              </div>

              <div className='grid grid-cols-[36px_1fr] font-mono text-xs leading-loose bg-[#08080a] rounded-lg border border-white/[0.08] overflow-hidden my-3'>
                <span className='text-zinc-600 text-right pr-2.5 select-none'>38</span>
                <div className='px-2.5 overflow-x-auto'><code>const session = await getSession(token);</code></div>

                <span className='text-zinc-600 text-right pr-2.5 select-none'>39</span>
                <div className='px-2.5 overflow-x-auto text-rose-400 bg-rose-500/10'><code>− await store.set(key, session);</code></div>

                <span className='text-zinc-600 text-right pr-2.5 select-none'>40</span>
                <div className='px-2.5 overflow-x-auto text-emerald-400 bg-emerald-500/10'><code>+ await store.set(key, sanitize(session));</code></div>

                <span className='text-zinc-600 text-right pr-2.5 select-none'>41</span>
                <div className='px-2.5 overflow-x-auto'><code>return session;</code></div>
              </div>

              <div className='border border-violet-500/30 rounded-lg p-4 bg-gradient-to-br from-violet-950/30 to-zinc-950/90 backdrop-blur-md mt-4'>
                <div className='flex items-center gap-2 text-xs font-semibold text-white'>
                  <IconSparkles size={16} className='text-violet-400' />
                  <span>Potential token leakage in return statement</span>
                  <Badge variant='destructive' className='ml-auto text-[10px] font-semibold uppercase tracking-wider rounded-md'>
                    High Severity
                  </Badge>
                </div>
                <p className='text-neutral-300 text-xs leading-relaxed my-2.5'>
                  While the cached object in Redis is now sanitized, callers of <code>getSession(token)</code> still receive the original unsanitized session object containing raw refresh tokens. Return the sanitized instance here as well.
                </p>
                <Button size='sm' variant='secondary' className='gap-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 text-white'>
                  <IconCheck size={14} />
                  <span>Apply suggested patch: return sanitize(session);</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Visual Inspection Gallery with PlaceCards */}
        <div className='mt-20'>
          <div className='text-center max-w-2xl mx-auto mb-10'>
            <Badge variant='secondary' className='rounded-full px-3 py-0.5 text-xs font-mono tracking-wider uppercase bg-white/10 text-neutral-300'>
              Deep Capabilities
            </Badge>
            <h3 className='text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-white mt-3 mb-2'>
              Architected for{' '}
              <span className='bg-gradient-to-r from-sky-400 via-indigo-300 to-white bg-clip-text text-transparent font-extrabold'>
                Precision
              </span>{' '}
              at scale
            </h3>
            <p className='text-neutral-400 text-sm'>
              Hover to examine how our specialized models dissect syntax, imports, and cross-service boundaries.
            </p>
          </div>

          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
            <PlaceCard
              title='AST-Aware Parser'
              description='Extracts full semantic syntax trees across monorepo package boundaries in under 400ms.'
              image='https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop&q=80'
              badge='Parser'
            />
            <PlaceCard
              title='Security Vulnerability Audit'
              description='Detects authentication bypasses, sanitization gaps, and credential exposures.'
              image='https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop&q=80'
              badge='Security'
            />
            <PlaceCard
              title='Automated 1-Click Fixes'
              description='Synthesizes production-ready diffs directly compatible with GitHub suggested changes.'
              image='https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&auto=format&fit=crop&q=80'
              badge='Diff Engine'
            />
            <PlaceCard
              title='Monorepo Dependency Graph'
              description='Tracks side-effects across pnpm and turborepo workspaces with zero overhead.'
              image='https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop&q=80'
              badge='Monorepo'
            />
          </div>
        </div>

        {/* Live Velocity & Telemetry Graph */}
        <div className='mt-24'>
          <div className='text-center max-w-2xl mx-auto mb-10'>
            <Badge variant='secondary' className='rounded-full px-3 py-0.5 text-xs font-mono tracking-wider uppercase bg-white/10 text-neutral-300'>
              Telemetry
            </Badge>
            <h3 className='text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-white mt-3 mb-2'>
              Proven impact on{' '}
              <MarkerHighlight
                highlight='Engineering Velocity'
                markerColor='#38bdf8'
                baseColor='#ffffff'
                highlightedTextColor='#020617'
              />
            </h3>
            <p className='text-neutral-400 text-sm'>
              Measured across 450,000+ reviewed pull requests in mission-critical repositories.
            </p>
          </div>

          <ChartBarMixed />
        </div>
      </section>

      {/* ================= MOVING REVIEWS (MARQUEE WITH BLURRED SIDES - 100% TAILWIND) ================= */}
      <section id='testimonials' className='relative z-10 w-full py-24 border-t border-white/[0.08] overflow-hidden'>
        <div className='text-center max-w-3xl mx-auto mb-14 px-6 flex flex-col items-center'>
          {/* Social Proof Avatar Stack cleanly docked in reviews */}
          <div className='mb-5'>
            <AvatarSocialProof />
          </div>

          <Badge variant='secondary' className='rounded-full px-3 py-0.5 text-xs font-mono tracking-wider uppercase bg-white/10 text-neutral-300'>
            Reviews & Feedback
          </Badge>
          <h2 className='text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mt-4 mb-4 leading-tight'>
            We&apos;ve been blown away by the love & support from teams
          </h2>
          <p className='text-neutral-400 text-base leading-relaxed'>
            From hyper-growth seed startups to enterprise platform teams, engineers use AI Code Reviewer to ship cleaner code with speed.
          </p>
        </div>

        {/* Marquee Viewport with Left/Right Blur Overlays */}
        <div className='relative w-full overflow-hidden py-3 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]'>
          {/* Left & Right blurred side overlays */}
          <div className='pointer-events-none absolute top-0 bottom-0 left-0 w-28 md:w-44 bg-gradient-to-r from-black to-transparent backdrop-blur-[2px] z-20' aria-hidden='true' />
          <div className='pointer-events-none absolute top-0 bottom-0 right-0 w-28 md:w-44 bg-gradient-to-l from-black to-transparent backdrop-blur-[2px] z-20' aria-hidden='true' />

          {/* Row 1: Forward scrolling */}
          <div className='flex gap-4.5 w-max animate-marquee hover:[animation-play-state:paused]'>
            {[...reviewsRow1, ...reviewsRow1].map((review, idx) => (
              <div
                key={`row1-${idx}-${review.author}`}
                className='w-[360px] md:w-[400px] shrink-0 p-5 rounded-xl bg-zinc-950/70 border border-white/[0.08] backdrop-blur-md hover:border-white/20 hover:bg-zinc-900/80 transition-all flex flex-col justify-between user-select-none'
              >
                <p className='text-neutral-300 text-sm leading-relaxed mb-4'>&ldquo;{review.quote}&rdquo;</p>
                <div className='flex items-center justify-between border-t border-white/[0.08] pt-3.5'>
                  <div className='flex flex-col'>
                    <span className='text-white text-xs font-semibold'>{review.author}</span>
                    <span className='text-neutral-500 text-[11px]'>{review.title}</span>
                  </div>
                  <div className='w-8 h-8 rounded-full border border-white/[0.08] bg-zinc-800 flex items-center justify-center font-semibold text-xs text-white'>
                    {review.avatar}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Row 2: Reverse scrolling */}
          <div className='flex gap-4.5 w-max animate-marquee-reverse hover:[animation-play-state:paused] mt-4.5'>
            {[...reviewsRow2, ...reviewsRow2].map((review, idx) => (
              <div
                key={`row2-${idx}-${review.author}`}
                className='w-[360px] md:w-[400px] shrink-0 p-5 rounded-xl bg-zinc-950/70 border border-white/[0.08] backdrop-blur-md hover:border-white/20 hover:bg-zinc-900/80 transition-all flex flex-col justify-between user-select-none'
              >
                <p className='text-neutral-300 text-sm leading-relaxed mb-4'>&ldquo;{review.quote}&rdquo;</p>
                <div className='flex items-center justify-between border-t border-white/[0.08] pt-3.5'>
                  <div className='flex flex-col'>
                    <span className='text-white text-xs font-semibold'>{review.author}</span>
                    <span className='text-neutral-500 text-[11px]'>{review.title}</span>
                  </div>
                  <div className='w-8 h-8 rounded-full border border-white/[0.08] bg-zinc-800 flex items-center justify-center font-semibold text-xs text-white'>
                    {review.avatar}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= WORKFLOW SECTION ================= */}
      <section id='workflow' className='relative z-10 max-w-7xl mx-auto px-6 py-24 border-t border-white/[0.08]'>
        <div className='max-w-xl mb-12'>
          <Badge variant='secondary' className='rounded-full px-3 py-0.5 text-xs font-mono tracking-wider uppercase bg-white/10 text-neutral-300'>
            How It Works
          </Badge>
          <h2 className='text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mt-4 leading-tight'>
            One installation.<br />A superhuman second pass.
          </h2>
        </div>

        <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-center'>
          {/* Steps 1 & 2 */}
          <div className='lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4'>
            <Card className='p-6 bg-zinc-950/60 border-white/[0.08] backdrop-blur-md hover:border-white/20 transition-all rounded-xl flex flex-col justify-between'>
              <div>
                <span className='font-mono text-xs text-neutral-500 font-semibold mb-4 block'>01</span>
                <IconBrandGithub className='w-6 h-6 text-white mb-3' />
                <h3 className='text-base font-semibold text-white mb-2'>Connect Repos</h3>
                <p className='text-neutral-400 text-xs leading-relaxed'>
                  Install the GitHub App with granular permissions. Your source code is never stored or used to train models.
                </p>
              </div>
            </Card>

            <Card className='p-6 bg-zinc-950/60 border-white/[0.08] backdrop-blur-md hover:border-white/20 transition-all rounded-xl flex flex-col justify-between'>
              <div>
                <span className='font-mono text-xs text-neutral-500 font-semibold mb-4 block'>02</span>
                <IconGitPullRequest className='w-6 h-6 text-white mb-3' />
                <h3 className='text-base font-semibold text-white mb-2'>Open a PR</h3>
                <p className='text-neutral-400 text-xs leading-relaxed'>
                  Reviewer parses the AST diff, traces cross-service imports, and checks security boundaries automatically.
                </p>
              </div>
            </Card>

            <Card className='p-6 bg-zinc-950/60 border-white/[0.08] backdrop-blur-md hover:border-white/20 transition-all rounded-xl flex flex-col justify-between'>
              <div>
                <span className='font-mono text-xs text-neutral-500 font-semibold mb-4 block'>03</span>
                <IconCheck className='w-6 h-6 text-white mb-3' />
                <h3 className='text-base font-semibold text-white mb-2'>Ship Safely</h3>
                <p className='text-neutral-400 text-xs leading-relaxed'>
                  Actionable, polite inline suggestions with copy-paste git patches arrive directly in the GitHub PR review.
                </p>
              </div>
            </Card>
          </div>

          {/* Live Pipeline Animation Widget with SetupSteps */}
          <div className='p-6 rounded-2xl bg-zinc-950/80 border border-white/[0.08] backdrop-blur-xl flex flex-col items-center justify-center shadow-xl'>
            <div className='flex items-center justify-between w-full mb-3 pb-3 border-b border-white/[0.06]'>
              <div className='flex items-center gap-2'>
                <span className='w-2 h-2 rounded-full bg-emerald-400 animate-pulse' />
                <span className='text-xs font-semibold text-white'>Live Inspection Pipeline</span>
              </div>
              <Badge variant='outline' className='text-[10px] text-neutral-400 border-white/10'>
                Real-time
              </Badge>
            </div>
            <SetupSteps duration={2800} />
          </div>
        </div>
      </section>

      {/* ================= BOTTOM CALL TO ACTION (VERCEL STYLE) ================= */}
      <section id='services' className='relative z-10 max-w-7xl mx-auto px-6 mb-24'>
        <div className='p-12 md:p-16 rounded-2xl bg-gradient-to-b from-zinc-900/70 to-zinc-950 border border-white/[0.08] text-center shadow-2xl'>
          <Badge variant='secondary' className='rounded-full px-3 py-0.5 text-xs font-mono tracking-wider uppercase bg-white/10 text-neutral-300'>
            Start Today
          </Badge>
          <h2 className='text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mt-4 mb-4 leading-tight'>
            Accelerate your code review velocity.
          </h2>
          <p className='max-w-xl mx-auto text-neutral-400 text-base leading-relaxed mb-8'>
            Join thousands of developers shipping cleaner, safer software with context-aware AI pull request intelligence.
          </p>
          <Link href='/dashboard'>
            <Button size='lg' className='rounded-full px-8 h-12 text-sm font-semibold bg-white text-black hover:bg-white/90'>
              Connect Your First Repository
            </Button>
          </Link>
        </div>
      </section>

      {/* ================= COMPREHENSIVE, BEAUTIFUL VERCEL-STYLE FOOTER ================= */}
      <footer className='relative z-10 border-t border-white/[0.08] bg-black/90 text-neutral-400 text-sm pt-16 pb-12'>
        <div className='max-w-7xl mx-auto px-6'>
          {/* Top Multi-Column Grid */}
          <div className='grid grid-cols-2 md:grid-cols-5 gap-10 mb-14'>
            {/* Column 1: Brand & Status */}
            <div className='col-span-2'>
              <Link href='/' className='flex items-center gap-2 text-white font-semibold text-sm tracking-tight mb-3'>
                <span className='flex items-center justify-center w-7 h-7 rounded-lg bg-white text-black'>
                  <IconCode className='w-4 h-4' />
                </span>
                <span className='font-semibold text-base'>AI Code Reviewer</span>
              </Link>
              <p className='text-neutral-500 text-xs leading-relaxed max-w-sm mb-5'>
                Context-aware pull request intelligence powered by advanced repository indexing, AST verification, and multi-agent AI reasoning.
              </p>
              <div className='inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/[0.08] text-xs text-neutral-400'>
                <span className='w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]' />
                <span>All systems operational</span>
              </div>
            </div>

            {/* Column 2: Product */}
            <div className='flex flex-col gap-2.5'>
              <span className='text-xs font-semibold text-white uppercase tracking-wider mb-1'>Product</span>
              <a href='#services' className='text-xs text-neutral-400 hover:text-white transition-colors'>Overview</a>
              <a href='#preview' className='text-xs text-neutral-400 hover:text-white transition-colors'>PR Intelligence</a>
              <Link href='/dashboard' className='text-xs text-neutral-400 hover:text-white transition-colors'>Dashboard</Link>
              <Link href='/dashboard/repos' className='text-xs text-neutral-400 hover:text-white transition-colors'>Repositories</Link>
              <Link href='/dashboard/keys' className='text-xs text-neutral-400 hover:text-white transition-colors'>API Keys</Link>
              <a href='#workflow' className='text-xs text-neutral-400 hover:text-white transition-colors'>Workflow</a>
            </div>

            {/* Column 3: Integrations */}
            <div className='flex flex-col gap-2.5'>
              <span className='text-xs font-semibold text-white uppercase tracking-wider mb-1'>Integrations</span>
              <a href='#stack' className='text-xs text-neutral-400 hover:text-white transition-colors'>GitHub App</a>
              <a href='#stack' className='text-xs text-neutral-400 hover:text-white transition-colors'>Next.js & React</a>
              <a href='#stack' className='text-xs text-neutral-400 hover:text-white transition-colors'>TypeScript & Node</a>
              <a href='#stack' className='text-xs text-neutral-400 hover:text-white transition-colors'>Python & FastApi</a>
              <a href='#stack' className='text-xs text-neutral-400 hover:text-white transition-colors'>Turborepo & Monorepos</a>
              <a href='#stack' className='text-xs text-neutral-400 hover:text-white transition-colors'>Docker Containers</a>
            </div>

            {/* Column 4: Resources */}
            <div className='flex flex-col gap-2.5'>
              <span className='text-xs font-semibold text-white uppercase tracking-wider mb-1'>Resources</span>
              <Link href='/dashboard' className='text-xs text-neutral-400 hover:text-white transition-colors'>Documentation</Link>
              <Link href='/dashboard' className='text-xs text-neutral-400 hover:text-white transition-colors'>API Contract</Link>
              <Link href='/dashboard' className='text-xs text-neutral-400 hover:text-white transition-colors'>MCP Server</Link>
              <a href='#testimonials' className='text-xs text-neutral-400 hover:text-white transition-colors'>Customer Reviews</a>
              <span className='text-xs text-neutral-500'>Security Whitepaper</span>
              <span className='text-xs text-neutral-500'>Privacy Policy</span>
            </div>
          </div>

          <Separator className='bg-white/[0.08] my-8' />

          {/* Bottom Bar: Copyright, Tech Credit, Social Links */}
          <div className='flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-500'>
            <span>© 2026 AI Code Reviewer, Inc. All rights reserved.</span>

            <div className='flex items-center gap-5'>
              <a
                href='https://github.com'
                target='_blank'
                rel='noopener noreferrer'
                className='text-neutral-400 hover:text-white transition-colors'
                aria-label='GitHub'
              >
                <IconBrandGithub size={18} />
              </a>
              <a
                href='https://x.com'
                target='_blank'
                rel='noopener noreferrer'
                className='text-neutral-400 hover:text-white transition-colors'
                aria-label='Twitter / X'
              >
                <IconBrandX size={18} />
              </a>
              <a
                href='https://discord.com'
                target='_blank'
                rel='noopener noreferrer'
                className='text-neutral-400 hover:text-white transition-colors'
                aria-label='Discord'
              >
                <IconBrandDiscord size={18} />
              </a>
              <a href='#top' className='ml-2 text-neutral-400 hover:text-white transition-colors'>
                Back to top ↑
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
