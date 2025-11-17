import {Injectable} from '@nestjs/common';
import {GeminiService} from '../../../common/ai/gemini.service';

type GenCypherResult = { cypher: string };

@Injectable()
export class LlmService {
    private MODEL = 'gemini-2.0-flash-exp';

    constructor(private readonly geminiService: GeminiService) {
    }

    // === 1) Stronger system prompt w/ contributor rules & examples ===
    private systemPrompt() {
        return String.raw`
You write Memgraph/Neo4j Cypher for a code graph.

DATA MODEL
- Nodes:
  :ASTNode { local_id, snapshot_id, type, name, file_path, commit_id, metadata, snippet? }
  :Contributor { local_id, snapshot_id, name, email, commit_id, metadata }  // metadata.email is common
- Relationships:
  :CODE_EDGE { relation, metadata } between any two nodes
  - contributor edges use relation IN ['authored_by','last_touched_by']
  - r.metadata may include {sha, author_time}

GLOBAL RULES
- ALWAYS filter by snapshot on every label you bind: {snapshot_id: $snapshot_id}
- DO NOT use anonymous target nodes inside atoms (n)-[:CODE_EDGE]->()  // not supported
- Expand edges with OPTIONAL MATCH only, and always bind both ends: (n)-[r:CODE_EDGE]->(m)
- Use parameters (do NOT quote $snapshot_id)
- Prefer compact results and include a LIMIT
- Return triples: RETURN n, r, m  (r or m can be null due to OPTIONAL MATCH)

WHEN THE USER ASKS ABOUT AUTHORS/OWNERS/CONTRIBUTORS
- Expand contributors like this:
    OPTIONAL MATCH (n)-[r:CODE_EDGE]->(m:Contributor {snapshot_id: $snapshot_id})
    WHERE r.relation IN ['authored_by','last_touched_by']
- You may scope by file or name:
    WHERE n.file_path ENDS WITH $file OR n.file_path CONTAINS $file
    OR  n.name CONTAINS $symbol
- Still return triples: RETURN n, r, m

GOOD EXAMPLES
// Authors of functions in a file
MATCH (n:ASTNode {snapshot_id: $snapshot_id})
WHERE n.type = 'Function' AND n.file_path ENDS WITH $file
OPTIONAL MATCH (n)-[r:CODE_EDGE]->(m:Contributor {snapshot_id: $snapshot_id})
WHERE r.relation IN ['authored_by','last_touched_by']
RETURN n, r, m
LIMIT 200

// Who last touched a symbol "parseConfig"
MATCH (n:ASTNode {snapshot_id: $snapshot_id})
WHERE n.name CONTAINS 'parseConfig'
OPTIONAL MATCH (n)-[r:CODE_EDGE]->(m:Contributor {snapshot_id: $snapshot_id})
WHERE r.relation = 'last_touched_by'
RETURN n, r, m
LIMIT 100

BAD (never do)
MATCH (n:ASTNode {snapshot_id: "$snapshot_id"})         // quoted param
MATCH (n)-[:CODE_EDGE]->()                               // anonymous node
RETURN n
`.trim();
    }

    // === 2) Optional query-aware hint to bias the model toward contributor patterns ===
    private contributorHint(userQuery: string) {
        if (
            /\b(author|contributor|contributors|blame|owner|who wrote|who touched|who last)\b/i.test(
                userQuery,
            )
        ) {
            return `
The user is asking about contributors. Prefer:
- OPTIONAL MATCH (n)-[r:CODE_EDGE]->(m:Contributor {snapshot_id: $snapshot_id})
- WHERE r.relation IN ['authored_by','last_touched_by']
- Keep RETURN n, r, m and add a LIMIT.
`.trim();
        }
        return '';
    }

    // === 3) Sanitizers & Validators ===

    /** Strip code fences, comments, params blocks, keep one statement */
    private sanitize(cypherRaw: string): string {
        let s = (cypherRaw || '').trim();

        // Remove fenced blocks but keep their content
        s = s.replace(/```+([a-z]*)\n?([\s\S]*?)```+/gi, (_, _lang, inner) =>
            inner.trim(),
        );

        // Remove obvious non-cypher lines
        const lines = s
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(
                (l) =>
                    l.length &&
                    !l.startsWith('//') &&
                    !l.startsWith('#') &&
                    !/^params?:/i.test(l) &&
                    !/^parameters?:/i.test(l) &&
                    !/^\$[a-z_][a-z0-9_]*\s*=/i.test(l),
            );

        s = lines.join('\n').trim();

        // Keep only the first statement if multiple
        const semi = s.indexOf(';');
        if (semi !== -1) s = s.slice(0, semi).trim();

        // Ensure it starts with a Cypher keyword
        const okStart =
            /^(match|optional|with|unwind|call|create|merge|return|explain)\b/i.test(
                s,
            );
        if (!okStart) {
            const idx = lines.findIndex((l) =>
                /^(match|optional|with|unwind|call|create|merge|return|explain)\b/i.test(
                    l,
                ),
            );
            if (idx >= 0) s = lines.slice(idx).join('\n').trim();
        }

        return s;
    }

    /** Static checks for Memgraph compatibility */
    private validateShape(cypher: string): string | null {
        if (!cypher) return 'Empty Cypher.';

        // must include snapshot param usage (unquoted)
        if (!/\{\s*snapshot_id\s*:\s*\$snapshot_id\s*\}/i.test(cypher)) {
            return 'Missing {snapshot_id: $snapshot_id} filter.';
        }
        if (/['"]\s*\$snapshot_id\s*['"]/.test(cypher)) {
            return 'Quoted $snapshot_id parameter.';
        }

        // forbid anonymous target atom like (n)-[:CODE_EDGE]->()
        if (/\)\s*-\s*\[\s*:?\s*CODE_EDGE[^\]]*\]\s*->\s*\(\s*\)/i.test(cypher)) {
            return 'Anonymous target node in relationship atom.';
        }

        // Must use OPTIONAL MATCH for relationships (edge expansion)
        const hasRel = /\-\s*\[\s*[^]]*\bCODE_EDGE\b[^]]*\]\s*->\s*\(/i.test(
            cypher,
        );
        const hasOptional = /optional\s+match/i.test(cypher);
        if (hasRel && !hasOptional) {
            return 'Edges must be expanded with OPTIONAL MATCH.';
        }

        // Must return n,r,m and have LIMIT
        if (!/\breturn\b\s+.*\bn\b.*\br\b.*\bm\b/i.test(cypher)) {
            return 'Must RETURN n, r, m.';
        }
        if (!/\blimit\s+\d+/i.test(cypher)) {
            return 'Missing LIMIT.';
        }

        return null; // valid
    }

    public async repairCypher(badCypher: string, dbError: string): Promise<string> {
        const prompt = this.makeRepairPrompt(badCypher, dbError);
        const raw = await this.callGemini(prompt);
        const cypher = this.sanitize(raw);
        // (Optional) reuse validateShape
        const why = this.validateShape(cypher);
        return !why ? cypher : this.fallbackCypher();
    }

    // === 4) Ask model ===
    private async callGemini(prompt: string): Promise<string> {
        return this.geminiService.generateCypherQuery(prompt);
    }

    // === 5) Repair prompt that includes the exact DB error ===
    private makeRepairPrompt(badCypher: string, dbError: string) {
        return String.raw`
Fix this Cypher so it runs on Memgraph.

ERROR
${dbError}

CURRENT
${badCypher}

REMEMBER
- Do NOT use (n)-[:CODE_EDGE]->() atoms. Use:
    OPTIONAL MATCH (n)-[r:CODE_EDGE]->(m)
- Always include {snapshot_id: $snapshot_id} and a LIMIT.
- Return n, r, m.
- Only output the fixed Cypher.
`.trim();
    }

    // === 6) Fallback template that always works ===
    private fallbackCypher(): string {
        return `
MATCH (n:ASTNode {snapshot_id: $snapshot_id})
WITH n
LIMIT 100
OPTIONAL MATCH (n)-[r:CODE_EDGE]->(m)
RETURN n, r, m
LIMIT 100
`.trim();
    }

    // === Public: generate with retry & repair ===
    async generateGraphCypher(
        userQuery: string,
        snapshotId: string,
    ): Promise<GenCypherResult> {
        const basePrompt = `
${this.systemPrompt()}

${this.contributorHint(userQuery)}

SNAPSHOT_ID: ${snapshotId}

USER QUERY:
${userQuery}

OUTPUT:
Write ONLY the Cypher. Obey the strict rules.
`.trim();

        // try 1: direct
        let raw = await this.callGemini(basePrompt);
        let cypher = this.sanitize(raw);
        let why = this.validateShape(cypher);
        if (!why) return {cypher};

        // try 2: self-repair without DB error
        const repair1 = this.makeRepairPrompt(cypher, `Static validation: ${why}`);
        raw = await this.callGemini(repair1);
        cypher = this.sanitize(raw);
        why = this.validateShape(cypher);
        if (!why) return {cypher};

        // last resort
        return {cypher: this.fallbackCypher()};
    }
}
