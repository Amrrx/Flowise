import { MigrationInterface, QueryRunner } from 'typeorm'

export class UniqueChatFlowNamePerWorkspace1788000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            WITH ranked AS (
                SELECT id,
                       ROW_NUMBER() OVER (PARTITION BY "workspaceId", name ORDER BY "createdDate", id) - 1 AS dup_rank
                  FROM chat_flow
            )
            UPDATE chat_flow
               SET name = chat_flow.name || ' (' || ranked.dup_rank || ')'
              FROM ranked
             WHERE chat_flow.id = ranked.id
               AND ranked.dup_rank > 0;
        `)
        await queryRunner.query(`CREATE UNIQUE INDEX idx_chat_flow_name_workspace ON chat_flow(name, "workspaceId");`)
        await queryRunner.query(`UPDATE chat_flow SET deployed = true WHERE deployed IS NULL OR deployed = false;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS idx_chat_flow_name_workspace;`)
    }
}
