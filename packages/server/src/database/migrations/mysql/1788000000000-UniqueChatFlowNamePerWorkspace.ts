import { MigrationInterface, QueryRunner } from 'typeorm'

export class UniqueChatFlowNamePerWorkspace1788000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE chat_flow cf
              JOIN (
                  SELECT id,
                         ROW_NUMBER() OVER (PARTITION BY workspaceId, name ORDER BY createdDate) - 1 AS dup_rank
                    FROM chat_flow
              ) ranked ON ranked.id = cf.id
               SET cf.name = CONCAT(cf.name, ' (', ranked.dup_rank, ')')
             WHERE ranked.dup_rank > 0;
        `)
        await queryRunner.query(`CREATE UNIQUE INDEX idx_chat_flow_name_workspace ON chat_flow(name, workspaceId);`)
        await queryRunner.query(`UPDATE chat_flow SET deployed = 1 WHERE deployed IS NULL OR deployed = 0;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX idx_chat_flow_name_workspace ON chat_flow;`)
    }
}
