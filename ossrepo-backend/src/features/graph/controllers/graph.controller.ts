import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Query,
    HttpCode,
    Patch,
    Put,
    Delete,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';

import {GraphService} from '../services/graph.service';
import {GraphStorageService} from '../services/graph-storage.service';
import {GraphBuilderService} from '../services/graph-builder.service';
import {UseGuards} from '@nestjs/common';
import {InternalTokenGuard} from '../../../common/guards/internal-token.guard';
import {BuildTaskDto, TriggerBuildDto} from '../dto/build-task.dto';
import {
    BuildSubtaskDto,
    CreateBuildSubtaskDto,
    UpdateBuildSubtaskDto,
} from '../dto/build-subtask.dto';
import {
    CreateGraphSnapshotDto,
    GraphSnapshotDto,
    UpdateGraphSnapshotDto,
} from '../dto/graph-snapshot.dto';
import {
    BatchCreateGraphNodeDto,
    CreateGraphNodeDto,
    GraphNodeDto,
    UpdateGraphNodeDto,
} from '../dto/graph-node.dto';
import {
    BatchCreateGraphEdgeDto,
    CreateGraphEdgeDto,
    GraphEdgeDto,
    UpdateGraphEdgeDto,
} from '../dto/graph-edge.dto';
import {
    CreateGraphExportDto,
    UpdateGraphExportDto,
    GraphExportDto,
} from '../dto/graph-export.dto';
import {LlmService} from '../services/llm.service';
import {MemgraphService} from '../services/memgraph.service';
import {iterAllValues} from '../utils/graph.mapper';
import {isNode, isRelationship} from 'neo4j-driver';

// ---- CONTROLLER ----
@Controller('graph')
export class GraphController {
    constructor(
        private readonly graphService: GraphService,
        private readonly graphBuilder: GraphBuilderService,
        private readonly graphStorage: GraphStorageService,
        private readonly llm: LlmService,
        private readonly memgraph: MemgraphService,
    ) {
    }

    @Get('subgraph')
    async querySubgraph(
        @Query('repoId') repoId: string,
        @Query('commitId') commitId: string | undefined,
        @Query('q') q: string,
    ) {
        // 1) Resolve snapshot
        const snap = (await this.graphStorage.getSnapshotByRepoCommit)
            ? await (this.graphStorage as any).getSnapshotByRepoCommit(
                repoId,
                commitId || null,
            )
            : (() => {
                throw new Error(
                    'Implement getSnapshotByRepoCommit(repoId, commitId) on GraphStorageService',
                );
            })();
        if (!snap)
            throw new NotFoundException('Snapshot not found for repo/commit');

        // 2) Ask LLM for Cypher
        let {cypher} = await this.llm.generateGraphCypher(q, snap.snapshot_id);

        // 3) Execute with a repair retry if Memgraph rejects it
        let rows: any[];
        try {
            rows = await this.memgraph.run<any>(cypher, {
                snapshot_id: snap.snapshot_id,
            });
        } catch (err: any) {
            const dbError = String(err?.message || err);
            try {
                if ((this.llm as any).repairCypher) {
                    const repaired = await (this.llm as any).repairCypher(
                        cypher,
                        dbError,
                    );
                    rows = await this.memgraph.run<any>(repaired, {
                        snapshot_id: snap.snapshot_id,
                    });
                    cypher = repaired;
                } else {
                    const fallback = `
MATCH (n:ASTNode {snapshot_id: $snapshot_id})
WITH n LIMIT 100
OPTIONAL MATCH (n)-[r:CODE_EDGE]->(m)
RETURN n, r, m LIMIT 100
          `.trim();
                    rows = await this.memgraph.run<any>(fallback, {
                        snapshot_id: snap.snapshot_id,
                    });
                    cypher = fallback;
                }
            } catch {
                throw err;
            }
        }

        // 4) Map rows to Cytoscape elements, then expand with contributors
        const nodesMap = new Map<string, any>();
        const edgesMap = new Map<string, any>();

        const getProps = (x: any) => (x && x.properties ? x.properties : x);

        const addNode = (nodeVal: any) => {
            if (!nodeVal) return;
            const props = getProps(nodeVal);
            const id = props?.local_id ?? props?.node_id ?? JSON.stringify(props);
            if (nodesMap.has(id)) return;

            const meta = props?.metadata;
            const isContributor = props?.type === 'Contributor';

            const code = isContributor
                ? ''
                : (props?.snippet ?? meta?.snippet ?? null);
            const sp = meta?.start_point;
            const ep = meta?.end_point;

            const s = Array.isArray(sp) ? Number(sp[0]) + 1 : undefined;
            const e = Array.isArray(ep) ? Number(ep[0]) + 1 : undefined;
            const location = isContributor
                ? props?.metadata?.email || ''
                : s && e
                    ? `${props.file_path ?? ''}:L${s}-L${e}`
                    : (props.file_path ?? '');

            let name = props?.name;
            if (!name || !name.trim()) {
                if (!isContributor && code) {
                    const first = code
                        .split(/\r?\n/)
                        .map((s: string) => s.trim())
                        .find(Boolean);
                    if (first) name = first.slice(0, 80);
                }
                if (!name)
                    name = isContributor
                        ? props?.metadata?.email || 'Contributor'
                        : `${props.type ?? 'Node'}${s ? `@L${s}` : ''}`;
            }

            nodesMap.set(id, {
                data: {
                    id,
                    label: isContributor
                        ? `👤 ${props?.name || name}`
                        : name || props.type || 'node',
                    type: props.type ?? null, // 'Contributor' or AST kind
                    name: props?.name ?? name ?? null,
                    location,
                    code,
                    email: isContributor ? props?.metadata?.email || null : null,
                },
            });
        };

        const addEdgeFromRow = (row: Record<string, any>) => {
            const n = row['n']; // left node
            const r = row['r']; // rel
            // NOTE: LLM query might use 'm' or 'c' for the right node
            const m = row['m'] ?? row['c'];
            if (!r) return;

            const nProps = getProps(n);
            const mProps = getProps(m);
            const rProps = getProps(r);

            const sid = rProps?.source_local_id ?? nProps?.local_id;
            const tid = rProps?.target_local_id ?? mProps?.local_id;
            if (!sid || !tid) return;

            const rel = rProps?.relation ?? 'EDGE';
            const id = `${sid}->${rel}->${tid}`;
            if (edgesMap.has(id)) return;

            const meta = rProps?.metadata || {};
            edgesMap.set(id, {
                data: {
                    id,
                    source: sid,
                    target: tid,
                    relation: rel, // 'authored_by' | 'last_touched_by' | others
                    role: rel, // for convenience in the UI
                    sha: meta.sha ?? null,
                    author_time: meta.author_time ?? null,
                },
            });
        };

        // First pass: whatever the LLM returned
        for (const row of rows as Array<Record<string, any>>) {
            const n = row['n'];
            const r = row['r'];
            const m = row['m'];
            if (n) addNode(n);
            if (m) addNode(m);
            if (r) addEdgeFromRow(row);
        }

        // Expand with contributors for all AST nodes currently in the result
        const astIds: string[] = [];
        for (const [, el] of nodesMap) {
            // only expand for AST nodes, not contributors
            if (el?.data?.type && el.data.type !== 'Contributor') {
                astIds.push(el.data.id);
            }
        }

        if (astIds.length) {
            const contribCypher = `
UNWIND $ids AS lid
MATCH (n:ASTNode {snapshot_id: $snapshot_id, local_id: lid})
OPTIONAL MATCH (n)-[r:CODE_EDGE]->(c:Contributor {snapshot_id: $snapshot_id})
RETURN n, r, c
      `.trim();
            const rows2 = await this.memgraph.run<any>(contribCypher, {
                snapshot_id: snap.snapshot_id,
                ids: astIds,
            });

            for (const row of rows2 as Array<Record<string, any>>) {
                const n = row['n'];
                const r = row['r'];
                const c = row['c']; // contributor
                if (n) addNode(n);
                if (c) addNode(c);
                if (r) addEdgeFromRow(row);
            }
        }

        const elements = [...nodesMap.values(), ...edgesMap.values()];
        return {snapshot_id: snap.snapshot_id, elements};
    }

    // --------- BUILD (PYTHON TRIGGER) -------------
    @Post('build/:repoId')
    @HttpCode(202)
    async triggerBuild(
        @Param('repoId') repoId: string,
        @Body() dto: TriggerBuildDto,
    ): Promise<BuildTaskDto> {
        return this.graphService.triggerBuild(repoId, dto);
    }

    @Get('status/:repoId')
    async getBuildStatus(
        @Param('repoId') repoId: string,
    ): Promise<BuildTaskDto | null> {
        return this.graphService.getBuildStatus(repoId);
    }

    @Patch('build/:taskId/status')
    @UseGuards(InternalTokenGuard)
    async updateBuildTaskStatus(
        @Param('taskId') taskId: string,
        @Body() body: { status: string; message?: string },
    ): Promise<BuildTaskDto> {
        return this.graphService.updateBuildTaskStatus(
            taskId,
            body.status,
            body.message,
        );
    }

    // GET /graph/build
    @Get('build')
    async getBuildTasks(
        @Query('repo_id') repoId?: string, // make repo_id optional
    ): Promise<BuildTaskDto[]> {
        if (repoId) {
            // If repo_id is provided, filter by repo_id
            return this.graphService.getBuildTasksByRepoId(repoId);
        } else {
            // Otherwise, return all build tasks
            return this.graphService.getAllBuildTasks();
        }
    }

    // --------- SUBTASKS (BUILDER) -----------------
    @Post('subtasks')
    async createSubtask(
        @Body() dto: CreateBuildSubtaskDto,
    ): Promise<BuildSubtaskDto> {
        return this.graphBuilder.createSubtask(dto);
    }

    @Get('subtasks/:subtaskId')
    async getSubtask(
        @Param('subtaskId') subtaskId: string,
    ): Promise<BuildSubtaskDto | null> {
        return this.graphBuilder.getSubtask(subtaskId);
    }

    @Patch('subtasks/:subtaskId')
    async updateSubtask(
        @Param('subtaskId') subtaskId: string,
        @Body() dto: UpdateBuildSubtaskDto,
    ): Promise<BuildSubtaskDto> {
        return this.graphBuilder.updateSubtask(subtaskId, dto);
    }

    @Delete('subtasks/:subtaskId')
    async deleteSubtask(@Param('subtaskId') subtaskId: string) {
        await this.graphBuilder.deleteSubtask(subtaskId);
        return {success: true};
    }

    @Get('subtasks/by-task/:taskId')
    async getSubtasksByTask(
        @Param('taskId') taskId: string,
    ): Promise<BuildSubtaskDto[]> {
        return this.graphBuilder.getSubtasksByTask(taskId);
    }

    // --------- SNAPSHOTS --------------------------
    @Post('snapshots')
    async createSnapshot(
        @Body() dto: CreateGraphSnapshotDto,
    ): Promise<GraphSnapshotDto> {
        return this.graphStorage.createGraphSnapshot(dto);
    }

    @Get('snapshots/:snapshotId')
    async getSnapshot(
        @Param('snapshotId') snapshotId: string,
    ): Promise<GraphSnapshotDto | null> {
        return this.graphStorage.getGraphSnapshotById(snapshotId);
    }

    @Patch('snapshots/:snapshotId')
    async updateSnapshot(
        @Param('snapshotId') snapshotId: string,
        @Body() dto: UpdateGraphSnapshotDto,
    ): Promise<GraphSnapshotDto> {
        return this.graphStorage.updateGraphSnapshot({
            ...dto,
            snapshot_id: snapshotId,
        });
    }

    @Delete('snapshots/:snapshotId')
    async deleteSnapshot(@Param('snapshotId') snapshotId: string) {
        await this.graphStorage.deleteGraphSnapshot(snapshotId);
        return {success: true};
    }

    @Get('snapshots/by-subtask/:subtaskId')
    async getSnapshotsBySubtask(
        @Param('subtaskId') subtaskId: string,
    ): Promise<GraphSnapshotDto[]> {
        return this.graphStorage.getSnapshotsBySubtask(subtaskId);
    }

    @Get('snapshots/by-repo/:repoId')
    async getSnapshotsByRepo(
        @Param('repoId') repoId: string,
    ): Promise<GraphSnapshotDto[]> {
        return this.graphStorage.getSnapshotsByRepo(repoId);
    }

    // --------- NODES ------------------------------
    @Post('nodes/batch')
    async batchCreateNodes(
        @Body() batch: BatchCreateGraphNodeDto,
    ): Promise<{ count: number }> {
        return this.graphStorage.createNodes(batch);
    }

    @Post('nodes/:snapshotId')
    async createNode(
        @Param('snapshotId') snapshotId: string,
        @Body() dto: CreateGraphNodeDto,
    ): Promise<GraphNodeDto> {
        return this.graphStorage.createNode(snapshotId, dto);
    }

    @Get('nodes/:snapshotId')
    async getNodesBySnapshot(
        @Param('snapshotId') snapshotId: string,
    ): Promise<GraphNodeDto[]> {
        return this.graphStorage.getNodesBySnapshot(snapshotId);
    }

    @Put('nodes/:nodeId')
    async updateNode(
        @Param('nodeId') node_id: string,
        @Body() dto: UpdateGraphNodeDto,
    ): Promise<GraphNodeDto> {
        return this.graphStorage.updateNode({...dto, node_id});
    }

    @Delete('nodes/:nodeId')
    async deleteNode(@Param('nodeId') node_id: string) {
        await this.graphStorage.deleteNode({node_id});
        return {success: true};
    }

    @Delete('nodes/by-snapshot/:snapshotId')
    async deleteNodesBySnapshot(@Param('snapshotId') snapshot_id: string) {
        await this.graphStorage.deleteNodesBySnapshot({snapshot_id});
        return {success: true};
    }

    // --------- EDGES ------------------------------
    @Post('edges/batch')
    async batchCreateEdges(
        @Body() batch: BatchCreateGraphEdgeDto,
    ): Promise<{ count: number }> {
        return this.graphStorage.createEdges(batch);
    }

    @Post('edges/:snapshotId')
    async createEdge(
        @Param('snapshotId') snapshotId: string,
        @Body() dto: CreateGraphEdgeDto,
    ): Promise<GraphEdgeDto> {
        return this.graphStorage.createEdge(snapshotId, dto);
    }

    @Get('edges/:snapshotId')
    async getEdgesBySnapshot(
        @Param('snapshotId') snapshotId: string,
    ): Promise<GraphEdgeDto[]> {
        return this.graphStorage.getEdgesBySnapshot(snapshotId);
    }

    @Put('edges/:edgeId')
    async updateEdge(
        @Param('edgeId') edge_id: string,
        @Body() dto: UpdateGraphEdgeDto,
    ): Promise<GraphEdgeDto> {
        return this.graphStorage.updateEdge({...dto, edge_id});
    }

    @Delete('edges/:edgeId')
    async deleteEdge(@Param('edgeId') edge_id: string) {
        await this.graphStorage.deleteEdge({edge_id});
        return {success: true};
    }

    @Delete('edges/by-snapshot/:snapshotId')
    async deleteEdgesBySnapshot(@Param('snapshotId') snapshot_id: string) {
        await this.graphStorage.deleteEdgesBySnapshot({snapshot_id});
        return {success: true};
    }

    // in GraphController
    @Get('debug/file-touch')
    async debugFileTouch(
        @Query('repoId') repoId: string,
        @Query('sha') sha: string,
    ) {
        const cypher = `
  MATCH (:Repo {id: $repoId})-[:HAS_BRANCH]->(b)-[:HAS_COMMIT]->(c:Commit {sha: $sha})
  MATCH (c)-[t:TOUCHED]->(f:File)
  OPTIONAL MATCH (author:Contributor)-[:AUTHORED]->(c)
  OPTIONAL MATCH (author)-[:AUTHORED]->(prev:Commit)-[pt:TOUCHED]->(f)
    WHERE prev.committed_at < c.committed_at
  WITH c, author, f, t, count(DISTINCT prev) AS priorTouches
  RETURN c, author, f, t, priorTouches
  LIMIT 200
    `.trim();

        const rows = await this.memgraph.run<any>(cypher, {repoId, sha});
        return {repoId, sha, rows};
    }

    @Get('file-touch')
    async getFileTouchGraph(
        @Query('repoId') repoId: string,
        @Query('sha') sha: string,
    ) {
        const rows = await this.memgraph.run<{
            curr: any
            authors: any[]
            fileTouches: {
                file: any
                touch: any
                priorTouches: any
                pastCommits: any[]
            }[]
        }>(
            `
    MATCH (curr:Commit {sha: $sha})-[t:TOUCHED]->(f:File {repo_id: $repoId})
    OPTIONAL MATCH (f)<-[tPast:TOUCHED]-(past:Commit)
      WHERE past.committed_at < curr.committed_at

    WITH curr, f, t,
         collect(DISTINCT past)[..3] AS pastCommits,
         count(DISTINCT past)        AS priorTouches

    OPTIONAL MATCH (curr)<-[:AUTHORED]-(author:Contributor)

    WITH curr,
         collect(DISTINCT author)           AS authors,
         collect({
           file: f,
           touch: t,
           priorTouches: priorTouches,
           pastCommits: pastCommits
         })                                 AS fileTouches

    RETURN curr, authors, fileTouches
    `,
            {repoId, sha},
        )

        // If no row: no data
        if (!rows || rows.length === 0) {
            return {repoId, sha, nodes: [], links: []}
        }

        const {curr, authors, fileTouches} = rows[0]

        const nodesMap = new Map<string, any>()
        const links: any[] = []
        const linkKeys = new Set<string>()

        // ---- helper: normalize memgraph/neo4j ints, BigInt, etc. to plain number ----
        const toSafeNumber = (val: any, fallback = 0): number => {
            if (val === null || val === undefined) return fallback

            if (typeof val === 'number') return val
            if (typeof val === 'bigint') return Number(val)

            if (typeof val === 'object') {
                // Neo4j-style integer { low, high }
                if (typeof (val as any).low === 'number') return (val as any).low
                // Some drivers expose .toNumber()
                if (typeof (val as any).toNumber === 'function') {
                    try {
                        return (val as any).toNumber()
                    } catch {
                        // fall through
                    }
                }
            }

            const parsed = Number(val)
            return Number.isNaN(parsed) ? fallback : parsed
        }

        const addNode = (id: string, payload: any) => {
            if (!id) return
            if (!nodesMap.has(id)) {
                nodesMap.set(id, {id, ...payload})
            } else {
                Object.assign(nodesMap.get(id)!, payload)
            }
        }

        const addLink = (source: string, target: string, type: string, weight = 1) => {
            if (!source || !target) return
            const key = `${source}|${target}|${type}`
            if (linkKeys.has(key)) return
            linkKeys.add(key)
            links.push({source, target, type, weight})
        }

        const cProps = curr.properties || {}
        const currId = `commit:${cProps.sha}`

        // --- current commit node ---
        addNode(currId, {
            kind: 'commit',
            role: 'current',
            sha: cProps.sha,
            label: cProps.message || cProps.sha?.slice(0, 7),
            committedAt: toSafeNumber(cProps.committed_at, 0),
            anomalyScore: toSafeNumber(cProps.anomaly_score, 0),
            anomalyFlags: Array.isArray(cProps.anomaly_flags)
                ? cProps.anomaly_flags.map(String)
                : [],
        })

        // --- contributor nodes ---
        for (const author of authors || []) {
            const a = author?.properties || {}
            const contribKey = a.email || a.key || a.name || 'unknown'
            const contribId = `contrib:${contribKey}`

            addNode(contribId, {
                kind: 'contributor',
                label: a.name || a.email || contribId,
                email: a.email,
                key: a.key,
            })

            addLink(contribId, currId, 'AUTHORED', 1)
        }

        // --- file + past commit nodes ---
        for (const ft of fileTouches || []) {
            if (!ft || !ft.file) continue

            const fNode = ft.file
            const fProps = fNode.properties || {}
            const tRel = ft.touch
            const tProps = tRel?.properties || {}

            const priorTouchesNum = toSafeNumber(ft.priorTouches, 0)
            const fileId = `file:${fProps.path}`

            const additions = toSafeNumber(
                tProps.additions ?? tProps.changes,
                0,
            )
            const deletions = toSafeNumber(tProps.deletions, 0)
            const totalDelta = additions + deletions

            const fileCategory = priorTouchesNum > 0 ? 'familiar' : 'new'

            const anomalyFlags: string[] = Array.isArray(cProps.anomaly_flags)
                ? cProps.anomaly_flags.map(String)
                : []

            const isSensitive =
                !!fProps.sensitive ||
                anomalyFlags.some((flag) => {
                    const f = flag.toLowerCase()
                    return f.includes('secret') || f.includes('sensitive')
                })

            addNode(fileId, {
                kind: 'file',
                label: fProps.path,
                path: fProps.path,
                priorTouches: priorTouchesNum,
                additions,
                deletions,
                fileCategory,
                isSensitive,
            })

            // totalDelta is now guaranteed to be a number, so Math.max is safe
            addLink(currId, fileId, 'TOUCHED', Math.max(1, totalDelta))

            for (const pc of ft.pastCommits || []) {
                if (!pc) continue
                const pProps = pc.properties || {}
                const pastId = `commit:${pProps.sha}`

                addNode(pastId, {
                    kind: 'commit',
                    role: 'past',
                    sha: pProps.sha,
                    label: pProps.sha?.slice(0, 7),
                    committedAt: toSafeNumber(pProps.committed_at, 0),
                    anomalyScore: toSafeNumber(pProps.anomaly_score, 0),
                    anomalyFlags: Array.isArray(pProps.anomaly_flags)
                        ? pProps.anomaly_flags.map(String)
                        : [],
                })

                addLink(pastId, fileId, 'HISTORICAL_TOUCH', 1)
            }
        }

        return {
            repoId,
            sha,
            nodes: Array.from(nodesMap.values()),
            links,
        }
    }

    @Get('file-diff')
    async getFileDiff(
        @Query('repoId') repoId: string,
        @Query('sha') sha: string,
        @Query('path') path: string,
    ) {
        if (!repoId || !sha || !path) {
            throw new BadRequestException('repoId, sha and path are required');
        }

        // repoId looks like "clerk/javascript"
        const [owner, repo] = repoId.split('/');
        if (!owner || !repo) {
            throw new BadRequestException(`Invalid repoId: ${repoId}`);
        }

        // Call GitHub API: GET /repos/{owner}/{repo}/commits/{sha}
        // Adapt to your existing GitHubService / GitHubAppService
        const res = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
            {
                headers: {
                    'User-Agent': 'oss-graph',
                    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
                    Accept: 'application/vnd.github+json',
                },
            },
        );
        if (!res.ok) throw new Error(`GitHub error ${res.status}`);
        const commit = await res.json();
        // commit.files is GitHub’s array of changed files
        const file = (commit.files || []).find(
            (f: any) => f.filename === path,
        );

        if (!file) {
            throw new BadRequestException(
                `File ${path} not found in commit ${sha}`,
            );
        }

        const blobUrl = `https://github.com/${owner}/${repo}/blob/${sha}/${path}`;

        return {
            repoId,
            sha,
            path,
            status: file.status,          // "modified", "added", etc
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch || '',      // unified diff text
            blobUrl,
        };
    }

}
