import { MigrationInterface, QueryRunner } from 'typeorm'

export class UniqueChatFlowNamePerWorkspace1788000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Resolve duplicates by appending " (N)". Order by (createdDate, id) so the
        // ordering is total — id is a unique UUID, so no ties remain even when
        // multiple rows share createdDate.
        await queryRunner.query(`
            UPDATE chat_flow
               SET name = name || ' (' || (
                   SELECT COUNT(*) FROM chat_flow AS dup
                    WHERE dup.workspaceId = chat_flow.workspaceId
                      AND dup.name = chat_flow.name
                      AND (
                          dup.createdDate < chat_flow.createdDate
                          OR (dup.createdDate = chat_flow.createdDate AND dup.id < chat_flow.id)
                      )
               ) || ')'
             WHERE id IN (
                 SELECT cf.id
                   FROM chat_flow cf
                   JOIN chat_flow other
                     ON other.workspaceId = cf.workspaceId
                    AND other.name = cf.name
                    AND (
                        other.createdDate < cf.createdDate
                        OR (other.createdDate = cf.createdDate AND other.id < cf.id)
                    )
             );
        `)
        await queryRunner.query(`CREATE UNIQUE INDEX idx_chat_flow_name_workspace ON chat_flow(name, workspaceId);`)
        // Backfill: existing flows are active. Default for new flows handled in UI.
        await queryRunner.query(`UPDATE chat_flow SET deployed = 1 WHERE deployed IS NULL OR deployed = 0;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS idx_chat_flow_name_workspace;`)
    }
}
