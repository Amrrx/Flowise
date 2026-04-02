
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddCurrentHistoryVersionToChatFlow1760000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const columnExists = await queryRunner.hasColumn('chat_flow', 'currentHistoryVersion')
        if (!columnExists) {
            await queryRunner.addColumn(
                'chat_flow',
                new TableColumn({
                    name: 'currentHistoryVersion',
                    type: 'int',
                    isNullable: true
                })
            )
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('chat_flow', 'currentHistoryVersion')
    }
}
