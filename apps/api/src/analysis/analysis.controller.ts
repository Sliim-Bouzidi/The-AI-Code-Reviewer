import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AnalyzeBodySchema, DiagramQuerySchema } from '@codereview/shared';
import type { Analysis, AnalyzeBody, BranchesResponse, Diagram, DiagramQuery } from '@codereview/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AnalysisService } from './analysis.service.js';

/** Structure graph and diagrams of a repository. Same auth and ownership rules as the other `/api/repos` routes. */
@Controller('api/repos')
@UseGuards(AuthGuard)
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  /** Branches of the repository, for the branch picker. */
  @Get(':id/branches')
  branches(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<BranchesResponse> {
    return this.analysis.branches(user.id, id);
  }

  /** Every analysed branch with its status. */
  @Get(':id/analyses')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Analysis[]> {
    return this.analysis.list(user.id, id);
  }

  /** (Re)analyse a branch (default branch when omitted): queued, returns immediately. */
  @Post(':id/analyze')
  start(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(AnalyzeBodySchema)) body: AnalyzeBody,
  ): Promise<Analysis> {
    return this.analysis.start(user.id, id, body.branch);
  }

  /** Mermaid diagram (+ nodes and edges as data) built from the stored graph of a branch. */
  @Get(':id/diagram')
  diagram(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodPipe(DiagramQuerySchema)) query: DiagramQuery,
  ): Promise<Diagram> {
    return this.analysis.diagram(user.id, id, query);
  }
}
